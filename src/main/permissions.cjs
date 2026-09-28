// Media permission gating. Only the dashboard window, loaded from a file://
// origin, may request media: the microphone (audio) for dictation and, for the
// meeting capture, the system-audio loopback — which Chromium surfaces as a
// display-capture / video request. Everything else is denied.
function configureMicrophonePermission({ session, getDashboardWebContents }) {
  // BrowserWindow identity is the trust boundary. Packaged Windows apps can
  // report a package-backed origin even when the page was loaded with
  // loadFile; WindowManager separately prevents external navigation.
  const isTrustedDashboard = (webContents, isMainFrame) =>
    webContents === getDashboardWebContents() && isMainFrame !== false;

  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) => {
      if (
        !isTrustedDashboard(webContents, details?.isMainFrame)
      ) {
        return false;
      }
      return permission === "media" || permission === "display-capture";
    },
  );
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const trusted = isTrustedDashboard(
        webContents,
        details?.isMainFrame,
      );
      callback(
        trusted &&
          (permission === "media" || permission === "display-capture"),
      );
    },
  );
}

module.exports = { configureMicrophonePermission };
