import CoreMIDI
import Foundation

struct MIDIPortInfo {
  let id: Int32
  let name: String
  let type: String // "input" | "output"
}

protocol MIDIBridgeDelegate: AnyObject {
  func midiBridge(_ bridge: MIDIBridge, didReceive bytes: [UInt8], fromSource id: Int32)
  func midiBridgePortsChanged(_ bridge: MIDIBridge)
}

/// Collects MIDI on the native side (CoreMIDI, USB or Bluetooth) and hands
/// 1.0-style byte messages to its delegate, which forwards them to the
/// Web MIDI shim running in the WKWebView. Delegate calls happen on the main
/// queue.
final class MIDIBridge {
  weak var delegate: MIDIBridgeDelegate?

  private var client = MIDIClientRef()
  private var inputPort = MIDIPortRef()
  private var outputPort = MIDIPortRef()
  private var connectedSources: [Int32: MIDIEndpointRef] = [:]
  // refCons identify the source inside the receive block. They are kept for
  // the lifetime of the app (4 bytes per endpoint) so a packet delivered
  // during a disconnect can never touch freed memory.
  private var sourceRefCons: [Int32: UnsafeMutablePointer<Int32>] = [:]

  func start() {
    guard client == 0 else { return }

    MIDIClientCreateWithBlock("Arabesque" as CFString, &client) { [weak self] notification in
      guard notification.pointee.messageID == .msgSetupChanged else { return }
      DispatchQueue.main.async {
        guard let self else { return }
        self.refreshSourceConnections()
        self.delegate?.midiBridgePortsChanged(self)
      }
    }

    MIDIInputPortCreateWithProtocol(client, "Arabesque Input" as CFString, ._1_0, &inputPort) {
      [weak self] eventList, refCon in
      self?.handle(eventList: eventList, refCon: refCon)
    }

    MIDIOutputPortCreate(client, "Arabesque Output" as CFString, &outputPort)

    refreshSourceConnections()
  }

  func portInfos() -> [MIDIPortInfo] {
    var infos: [MIDIPortInfo] = []
    for index in 0..<MIDIGetNumberOfSources() {
      let endpoint = MIDIGetSource(index)
      guard endpoint != 0, !isNetworkSession(endpoint) else { continue }
      infos.append(MIDIPortInfo(id: uniqueID(of: endpoint), name: displayName(of: endpoint), type: "input"))
    }
    for index in 0..<MIDIGetNumberOfDestinations() {
      let endpoint = MIDIGetDestination(index)
      guard endpoint != 0, !isNetworkSession(endpoint) else { continue }
      infos.append(MIDIPortInfo(id: uniqueID(of: endpoint), name: displayName(of: endpoint), type: "output"))
    }
    return infos
  }

  // iOS auto-creates a virtual "Session 1" endpoint (MIDINetworkSession) as
  // soon as Bluetooth MIDI Central is opened. It carries no real notes and
  // would otherwise beat the actual keyboard for the app's
  // auto-connect-to-first-input logic, so it's filtered out by comparing
  // against the exact endpoints MIDINetworkSession itself exposes.
  private func isNetworkSession(_ endpoint: MIDIEndpointRef) -> Bool {
    let session = MIDINetworkSession.default()
    return endpoint == session.sourceEndpoint() || endpoint == session.destinationEndpoint()
  }

  func send(_ bytes: [UInt8], toDestination id: Int32) {
    guard let destination = destination(withID: id) else { return }

    var words: [UInt32] = []
    var index = 0
    while index < bytes.count {
      let status = bytes[index]
      guard status >= 0x80 else {
        index += 1
        continue
      }
      let length = Self.midi1MessageLength(forStatus: status)
      let data1 = index + 1 < bytes.count ? bytes[index + 1] : 0
      let data2 = length > 2 && index + 2 < bytes.count ? bytes[index + 2] : 0
      words.append(0x2000_0000 | UInt32(status) << 16 | UInt32(data1) << 8 | UInt32(data2))
      index += length
    }
    guard !words.isEmpty else { return }

    var eventList = MIDIEventList()
    let packet = MIDIEventListInit(&eventList, ._1_0)
    _ = words.withUnsafeBufferPointer { buffer in
      MIDIEventListAdd(&eventList, MemoryLayout<MIDIEventList>.size, packet, 0, buffer.count, buffer.baseAddress!)
    }
    MIDISendEventList(outputPort, destination, &eventList)
  }

  // MARK: - Sources

  private func refreshSourceConnections() {
    var currentIDs: Set<Int32> = []
    for index in 0..<MIDIGetNumberOfSources() {
      let source = MIDIGetSource(index)
      guard source != 0 else { continue }
      let id = uniqueID(of: source)
      currentIDs.insert(id)
      guard connectedSources[id] == nil else { continue }

      let refCon: UnsafeMutablePointer<Int32>
      if let existing = sourceRefCons[id] {
        refCon = existing
      } else {
        refCon = UnsafeMutablePointer<Int32>.allocate(capacity: 1)
        refCon.initialize(to: id)
        sourceRefCons[id] = refCon
      }
      if MIDIPortConnectSource(inputPort, source, refCon) == noErr {
        connectedSources[id] = source
      }
    }

    for (id, source) in connectedSources where !currentIDs.contains(id) {
      MIDIPortDisconnectSource(inputPort, source)
      connectedSources.removeValue(forKey: id)
    }
  }

  private func handle(eventList: UnsafePointer<MIDIEventList>, refCon: UnsafeMutableRawPointer?) {
    guard let refCon else { return }
    let sourceID = refCon.assumingMemoryBound(to: Int32.self).pointee

    var messages: [[UInt8]] = []
    for packet in eventList.unsafeSequence() {
      messages.append(contentsOf: Self.midi1Messages(fromWords: words(of: packet)))
    }
    guard !messages.isEmpty else { return }

    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      for message in messages {
        self.delegate?.midiBridge(self, didReceive: message, fromSource: sourceID)
      }
    }
  }

  private func words(of packet: UnsafePointer<MIDIEventPacket>) -> [UInt32] {
    let count = Int(packet.pointee.wordCount)
    return withUnsafePointer(to: packet.pointee.words) { tuplePointer in
      tuplePointer.withMemoryRebound(to: UInt32.self, capacity: count) { wordsPointer in
        Array(UnsafeBufferPointer(start: wordsPointer, count: count))
      }
    }
  }

  /// Converts Universal MIDI Packet words (MIDI 1.0 protocol) back to classic
  /// 2/3-byte messages. Multi-word messages (SysEx, MIDI 2.0) are skipped but
  /// stepped over correctly so the words that follow them stay aligned.
  static func midi1Messages(fromWords words: [UInt32]) -> [[UInt8]] {
    var messages: [[UInt8]] = []
    var index = 0
    while index < words.count {
      let word = words[index]
      switch (word >> 28) & 0xF {
      case 0x2: // MIDI 1.0 channel voice
        let status = UInt8((word >> 16) & 0xFF)
        let data1 = UInt8((word >> 8) & 0x7F)
        let data2 = UInt8(word & 0x7F)
        messages.append(midi1MessageLength(forStatus: status) == 2 ? [status, data1] : [status, data1, data2])
        index += 1
      case 0x3, 0x4: // SysEx7, MIDI 2.0 channel voice
        index += 2
      case 0x5: // 128-bit data
        index += 4
      default: // utility, system real time, unknown
        index += 1
      }
    }
    return messages
  }

  static func midi1MessageLength(forStatus status: UInt8) -> Int {
    switch status & 0xF0 {
    case 0xC0, 0xD0: return 2
    default: return 3
    }
  }

  // MARK: - Endpoint properties

  private func destination(withID id: Int32) -> MIDIEndpointRef? {
    for index in 0..<MIDIGetNumberOfDestinations() {
      let endpoint = MIDIGetDestination(index)
      if endpoint != 0, uniqueID(of: endpoint) == id { return endpoint }
    }
    return nil
  }

  private func uniqueID(of endpoint: MIDIEndpointRef) -> Int32 {
    var id: Int32 = 0
    MIDIObjectGetIntegerProperty(endpoint, kMIDIPropertyUniqueID, &id)
    return id
  }

  private func displayName(of endpoint: MIDIEndpointRef) -> String {
    var name: Unmanaged<CFString>?
    if MIDIObjectGetStringProperty(endpoint, kMIDIPropertyDisplayName, &name) == noErr,
      let name = name?.takeRetainedValue() {
      return name as String
    }
    return "MIDI device"
  }
}
