// Show the exact members before splitting a group or recording training labels.
export function showUnmergeReview(button, senses, { onConfirm }) {
  const parent = button.parentNode;
  let panel = parent.querySelector('.unmerge-review');
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'unmerge-review';
    parent.appendChild(panel);
  }
  panel.replaceChildren();
  panel.hidden = false;
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Review meanings to unmerge');
  button.disabled = true;
  const title = document.createElement('p');
  title.textContent = `Split into ${senses.length} separate meanings?`;
  const list = document.createElement('ol');
  for (const sense of senses) {
    const item = document.createElement('li');
    item.textContent = sense.sourceDefinition || sense.definition || '';
    list.appendChild(item);
  }
  const confirm = document.createElement('button');
  confirm.type = 'button'; confirm.className = 'status-pill offline'; confirm.textContent = 'Unmerge these meanings';
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.className = 'status-pill offline'; cancel.textContent = 'Keep merged';
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const close = () => { panel.hidden = true; panel.replaceChildren(); button.disabled = false; };
  cancel.addEventListener('click', () => { close(); button.focus(); });
  confirm.addEventListener('click', async () => {
    confirm.disabled = true; cancel.disabled = true;
    try { await onConfirm(); close(); }
    catch (error) {
      status.textContent = error?.message || 'Could not unmerge these meanings.';
      confirm.disabled = false; cancel.disabled = false;
    }
  });
  panel.append(title, list, confirm, cancel, status);
  confirm.focus();
}
