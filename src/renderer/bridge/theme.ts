export function getThemeState() {
  return window.agentWorkbenchTheme.getThemeState();
}

export function setThemePreference(
  preference: Parameters<Window["agentWorkbenchTheme"]["setThemePreference"]>[0]
) {
  return window.agentWorkbenchTheme.setThemePreference(preference);
}

export function onThemeStateChanged(
  callback: Parameters<Window["agentWorkbenchTheme"]["onThemeStateChanged"]>[0]
) {
  return window.agentWorkbenchTheme.onThemeStateChanged(callback);
}
