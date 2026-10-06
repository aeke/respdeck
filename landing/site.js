const image = document.querySelector('#theme-image');
const themeButtons = document.querySelectorAll('[data-theme]');
for (const button of themeButtons) {
  button.addEventListener('click', () => {
    const theme = button.dataset.theme;
    image.src = `assets/${theme}.png`;
    image.alt = `RESPdeck workspace in ${theme} theme`;
    for (const item of themeButtons) item.setAttribute('aria-pressed', String(item === button));
  });
}
document.querySelector('#copy-install').addEventListener('click', async () => {
  const status = document.querySelector('#copy-status');
  try {
    await navigator.clipboard.writeText(document.querySelector('#install-commands').textContent);
    status.textContent = 'Copied. Paste into your terminal to get started.';
  } catch {
    status.textContent = 'Copy is unavailable here. Select the commands above to copy them.';
  }
});
