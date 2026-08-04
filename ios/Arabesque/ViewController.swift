import CoreAudioKit
import UIKit
import WebKit

/// Full-screen WKWebView hosting the existing web app, plus the glue between
/// the native MIDIBridge and the injected Web MIDI shim. A small overlay
/// button opens the system Bluetooth MIDI pairing sheet.
final class ViewController: UIViewController {
  private var webView: WKWebView!
  private let midiBridge = MIDIBridge()

  private var appURL: URL {
    let configured = Bundle.main.object(forInfoDictionaryKey: "PTWebAppURL") as? String
    return URL(string: configured ?? "https://isc.github.io/piano-trainer/")!
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    // The web app has no dark theme (it forces Pico to light), so keep the
    // whole native shell — background, status bar, system sheets — in light
    // mode too, rather than letting it follow the device's Dark Mode setting.
    overrideUserInterfaceStyle = .light
    view.backgroundColor = .systemBackground

    let contentController = WKUserContentController()
    if let shimURL = Bundle.main.url(forResource: "webmidi-shim", withExtension: "js"),
      let shim = try? String(contentsOf: shimURL) {
      contentController.addUserScript(
        WKUserScript(source: shim, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }
    contentController.add(WeakScriptMessageHandler(self), name: "midiBridge")

    let configuration = WKWebViewConfiguration()
    configuration.userContentController = contentController
    configuration.allowsInlineMediaPlayback = true
    configuration.mediaTypesRequiringUserActionForPlayback = []

    webView = WKWebView(frame: .zero, configuration: configuration)
    #if DEBUG
    if #available(iOS 16.4, *) {
      webView.isInspectable = true
    }
    #endif
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.allowsBackForwardNavigationGestures = true
    webView.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(webView)
    NSLayoutConstraint.activate([
      // The web app has no safe-area-aware CSS (no viewport-fit=cover), so
      // scrolled content would otherwise show through system chrome —
      // notably the transparent status bar, but also the notch/Dynamic
      // Island and home indicator on iPhone. Stay within the safe area on
      // all four edges rather than assuming this device's geometry (no
      // notch, physical home button).
      webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      webView.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
      webView.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
      webView.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
    ])

    let bluetoothButton = makeBluetoothButton()
    view.addSubview(bluetoothButton)
    NSLayoutConstraint.activate([
      bluetoothButton.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -12),
      bluetoothButton.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12),
    ])

    midiBridge.delegate = self
    midiBridge.start()

    webView.load(URLRequest(url: appURL))
  }

  // MARK: - Bluetooth MIDI pairing

  private func makeBluetoothButton() -> UIButton {
    var config = UIButton.Configuration.gray()
    config.image = UIImage(systemName: "antenna.radiowaves.left.and.right")
    config.cornerStyle = .capsule
    let button = UIButton(configuration: config, primaryAction: UIAction { [weak self] _ in
      self?.presentBluetoothMIDIPairing()
    })
    button.alpha = 0.6
    button.accessibilityLabel = "Bluetooth MIDI"
    button.translatesAutoresizingMaskIntoConstraints = false
    return button
  }

  private func presentBluetoothMIDIPairing() {
    let central = CABTMIDICentralViewController()
    central.navigationItem.rightBarButtonItem = UIBarButtonItem(
      barButtonSystemItem: .done, target: self, action: #selector(dismissPresented))
    let navigation = UINavigationController(rootViewController: central)
    navigation.modalPresentationStyle = .formSheet
    present(navigation, animated: true)
  }

  @objc private func dismissPresented() {
    dismiss(animated: true)
  }

  // MARK: - Native -> JS

  private func pushPorts() {
    let ports = midiBridge.portInfos().map { ["id": String($0.id), "name": $0.name, "type": $0.type] }
    guard let data = try? JSONSerialization.data(withJSONObject: ports),
      let json = String(data: data, encoding: .utf8) else { return }
    evaluate("window.__pianoTrainerMIDI && window.__pianoTrainerMIDI.setPorts(\(json))")
  }

  private func evaluate(_ script: String) {
    webView.evaluateJavaScript(script) { _, error in
      if let error { print("midiBridge JS error: \(error)") }
    }
  }
}

// MARK: - MIDIBridgeDelegate

extension ViewController: MIDIBridgeDelegate {
  func midiBridge(_ bridge: MIDIBridge, didReceive bytes: [UInt8], fromSource id: Int32) {
    evaluate("window.__pianoTrainerMIDI && window.__pianoTrainerMIDI.receiveMIDI('\(id)', \(bytes))")
  }

  func midiBridgePortsChanged(_ bridge: MIDIBridge) {
    pushPorts()
  }
}

// MARK: - JS -> native

extension ViewController: WKScriptMessageHandler {
  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.name == "midiBridge",
      let body = message.body as? [String: Any],
      let type = body["type"] as? String else { return }

    switch type {
    case "ready":
      pushPorts()
    case "send":
      guard let idString = body["id"] as? String, let id = Int32(idString),
        let data = body["data"] as? [Any] else { return }
      midiBridge.send(data.compactMap { ($0 as? NSNumber)?.uint8Value }, toDestination: id)
    default:
      break
    }
  }
}

// MARK: - Navigation: keep the app's host in the webview, open the rest in Safari

extension ViewController: WKNavigationDelegate {
  func webView(
    _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    if navigationAction.navigationType == .linkActivated,
      let url = navigationAction.request.url,
      url.host != appURL.host {
      UIApplication.shared.open(url)
      decisionHandler(.cancel)
      return
    }
    decisionHandler(.allow)
  }
}

// MARK: - JS dialogs (alert / confirm / prompt), silently dropped by WKWebView otherwise

extension ViewController: WKUIDelegate {
  func webView(
    _ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void
  ) {
    let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
    present(alert, animated: true)
  }

  func webView(
    _ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void
  ) {
    let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
    alert.addAction(UIAlertAction(title: "Annuler", style: .cancel) { _ in completionHandler(false) })
    present(alert, animated: true)
  }

  func webView(
    _ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
    initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void
  ) {
    let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
    alert.addTextField { $0.text = defaultText }
    alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(alert.textFields?.first?.text) })
    alert.addAction(UIAlertAction(title: "Annuler", style: .cancel) { _ in completionHandler(nil) })
    present(alert, animated: true)
  }
}

/// WKUserContentController retains its message handlers strongly; this proxy
/// avoids the resulting retain cycle with the view controller.
private final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
  private weak var target: WKScriptMessageHandler?

  init(_ target: WKScriptMessageHandler) {
    self.target = target
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    target?.userContentController(userContentController, didReceive: message)
  }
}
