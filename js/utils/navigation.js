export function navigateTo(view, onNavigate, location = globalThis.location) {
  if (location.hash === `#${view}`) onNavigate(view);
  else location.hash = view;
}
