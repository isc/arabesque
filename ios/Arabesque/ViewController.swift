import CoreAudioKit
import UIKit
import WebKit

/// The handful of strings the native shell shows on its own. The web app picks
/// its language from the browser locale; this does the same from the device's
/// preferred languages, rather than carrying a .strings file and a localization
/// build phase for five lines. Anything longer belongs in the web app.
private enum Strings {
  private static let french = Locale.preferredLanguages.first?.hasPrefix("fr") ?? false

  private static func pick(_ fr: String, _ en: String) -> String { french ? fr : en }

  static let ok = "OK"
  static var cancel: String { pick("Annuler", "Cancel") }
  static var loadFailureTitle: String { pick("Arabesque n’a pas pu se charger", "Arabesque could not load") }
  static var loadFailureBody: String {
    pick(
      "Vérifiez votre connexion à Internet, puis réessayez.",
      "Check your internet connection, then try again.")
  }
  static var retry: String { pick("Réessayer", "Try again") }
}

/// Full-screen WKWebView hosting the existing web app, plus the glue between
/// the native MIDIBridge and the injected Web MIDI shim. A small overlay
/// button opens the system Bluetooth MIDI pairing sheet.
final class ViewController: UIViewController {
  private var webView: WKWebView!
  private let midiBridge = MIDIBridge()
  /// Covers the webview when a load fails. Everything this app shows comes from
  /// the network, so without it a failed load is a blank white screen with no
  /// way out — the state an offline launch lands in.
  private lazy var loadFailureView: UIView = makeLoadFailureView()
  /// Samples the page's wake lock (see refreshScreenAwake).
  private var wakeLockPoll: Timer?

  private var appURL: URL {
    let configured = Bundle.main.object(forInfoDictionaryKey: "PTWebAppURL") as? String
    return URL(string: configured ?? "https://arabesque.app/")!
  }

  deinit {
    wakeLockPoll?.invalidate()
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    // The web app has no dark theme (it forces Pico to light), so keep the
    // whole native shell — background, status bar, system sheets — in light
    // mode too, rather than letting it follow the device's Dark Mode setting.
    overrideUserInterfaceStyle = .light
    view.backgroundColor = .systemBackground

    let contentController = WKUserContentController()
    // webmidi-shim emulates the Web MIDI API WebKit doesn't have, and talks
    // back through the message handler registered just below; wakelock-shim
    // replaces the screen wake lock WebKit refuses to grant in a WKWebView,
    // and is read back by polling (see "Keeping the screen on").
    for name in ["webmidi-shim", "wakelock-shim"] {
      guard let shimURL = Bundle.main.url(forResource: name, withExtension: "js"),
        let shim = try? String(contentsOf: shimURL) else { continue }
      contentController.addUserScript(
        WKUserScript(source: shim, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }
    contentController.add(WeakScriptMessageHandler(self), name: "midiBridge")

    let configuration = WKWebViewConfiguration()
    // The other half of the WKAppBoundDomains opt-in in project.yml. Declaring
    // that key puts every WKWebView in the app into a restricted mode where the
    // shims above — injected scripts and message handlers — would be refused;
    // this restores it, for the listed domains only. A PTWebAppURL pointing
    // anywhere else stops loading at all, with "App-bound domain failure".
    configuration.limitsNavigationsToAppBoundDomains = true
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

    view.addSubview(loadFailureView)
    NSLayoutConstraint.activate([
      loadFailureView.topAnchor.constraint(equalTo: webView.topAnchor),
      loadFailureView.bottomAnchor.constraint(equalTo: webView.bottomAnchor),
      loadFailureView.leadingAnchor.constraint(equalTo: webView.leadingAnchor),
      loadFailureView.trailingAnchor.constraint(equalTo: webView.trailingAnchor),
    ])

    // Added last so pairing stays reachable over both the webview and the
    // failure screen: a keyboard can be paired while the app is still offline.
    let bluetoothButton = makeBluetoothButton()
    view.addSubview(bluetoothButton)
    NSLayoutConstraint.activate([
      bluetoothButton.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -12),
      bluetoothButton.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12),
    ])

    NotificationCenter.default.addObserver(
      self, selector: #selector(appDidBecomeActive),
      name: UIApplication.didBecomeActiveNotification, object: nil)

    startPollingWakeLock()

    midiBridge.delegate = self
    midiBridge.start()

    loadWebApp()
  }

  // MARK: - Loading the web app

  private func loadWebApp() {
    webView.load(URLRequest(url: appURL))
  }

  @objc private func appDidBecomeActive() {
    // Coming back to a failure screen is the moment the connection has often
    // just been fixed — in Settings, or by plugging in — so spend the reload
    // rather than making the button the only way forward.
    if !loadFailureView.isHidden { loadWebApp() }
    // iOS restored the idle timer while the app was away and re-applies this
    // flag as it stands on the way back; the page may have changed since it
    // was last polled, and the next tick is up to ten seconds off.
    refreshScreenAwake()
  }

  private func makeLoadFailureView() -> UIView {
    let title = UILabel()
    title.text = Strings.loadFailureTitle
    title.font = .preferredFont(forTextStyle: .headline)
    title.adjustsFontForContentSizeCategory = true

    let body = UILabel()
    body.text = Strings.loadFailureBody
    body.font = .preferredFont(forTextStyle: .body)
    body.adjustsFontForContentSizeCategory = true
    body.textColor = .secondaryLabel

    for label in [title, body] {
      label.textAlignment = .center
      label.numberOfLines = 0
    }

    var config = UIButton.Configuration.filled()
    config.title = Strings.retry
    config.cornerStyle = .medium
    let retry = UIButton(
      configuration: config,
      primaryAction: UIAction { [weak self] _ in self?.loadWebApp() })

    let stack = UIStackView(arrangedSubviews: [title, body, retry])
    stack.axis = .vertical
    stack.alignment = .center
    stack.spacing = 12
    stack.setCustomSpacing(24, after: body)
    stack.translatesAutoresizingMaskIntoConstraints = false

    let container = UIView()
    container.backgroundColor = .systemBackground
    container.isHidden = true
    container.translatesAutoresizingMaskIntoConstraints = false
    container.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.centerXAnchor.constraint(equalTo: container.centerXAnchor),
      stack.centerYAnchor.constraint(equalTo: container.centerYAnchor),
      stack.leadingAnchor.constraint(greaterThanOrEqualTo: container.leadingAnchor, constant: 32),
      stack.trailingAnchor.constraint(lessThanOrEqualTo: container.trailingAnchor, constant: -32),
    ])
    return container
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

  // MARK: - Keeping the screen on

  /// Asks the page whether it is holding a screen wake lock — the only thing
  /// that knows when the screen is watched rather than touched (see README,
  /// "Keeping the screen on"). Asking rather than being told is the point: a
  /// document replaced by a navigation, or dropped from the back/forward
  /// cache, never gets to give its lock back, and a single message missed that
  /// way would leave the iPad lit for the rest of the session.
  ///
  /// iOS applies the flag only while the app is in the foreground, and restores
  /// normal behaviour by itself once it isn't.
  private func refreshScreenAwake() {
    webView.evaluateJavaScript("!!(window.__arabesqueWakeLock && window.__arabesqueWakeLock.held)") { result, _ in
      UIApplication.shared.isIdleTimerDisabled = (result as? Bool) ?? false
    }
  }

  /// Ten seconds is nothing against an Auto-Lock counted in minutes: it costs
  /// at most that much screen after a score is left, and delays nothing —
  /// opening one is polled long before the idle timer could have fired. The
  /// timer is idle while the app is suspended and picks up on its own
  /// afterwards, with `appDidBecomeActive` covering the gap.
  private func startPollingWakeLock() {
    wakeLockPoll = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in
      self?.refreshScreenAwake()
    }
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
      let body = message.body as? [String: Any] else { return }

    switch body["type"] as? String {
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

// MARK: - Navigation: keep the app's host in the webview, open the rest in
// Safari, and say so when nothing loads at all

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

  /// Hidden on commit rather than on didStartProvisionalNavigation: a retry that
  /// fails again would otherwise flash the blank webview in between.
  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
    loadFailureView.isHidden = true
  }

  func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error
  ) {
    showLoadFailure(error)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    showLoadFailure(error)
  }

  private func showLoadFailure(_ error: Error) {
    // A cancelled load is routine — a new navigation superseding the one in
    // flight reports it, and so does tapping Retry twice. Nothing failed.
    guard (error as NSError).code != NSURLErrorCancelled else { return }
    print("Arabesque: loading \(appURL) failed — \(error.localizedDescription)")
    loadFailureView.isHidden = false
  }
}

// MARK: - JS dialogs (alert / confirm / prompt), silently dropped by WKWebView otherwise

extension ViewController: WKUIDelegate {
  func webView(
    _ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void
  ) {
    let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: Strings.ok, style: .default) { _ in completionHandler() })
    present(alert, animated: true)
  }

  func webView(
    _ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void
  ) {
    let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: Strings.ok, style: .default) { _ in completionHandler(true) })
    alert.addAction(UIAlertAction(title: Strings.cancel, style: .cancel) { _ in completionHandler(false) })
    present(alert, animated: true)
  }

  func webView(
    _ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
    initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void
  ) {
    let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
    alert.addTextField { $0.text = defaultText }
    alert.addAction(UIAlertAction(title: Strings.ok, style: .default) { _ in completionHandler(alert.textFields?.first?.text) })
    alert.addAction(UIAlertAction(title: Strings.cancel, style: .cancel) { _ in completionHandler(nil) })
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
