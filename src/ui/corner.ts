const ICONS = {
  soundOff:
    '<path d="M3 9h3l4-3.5v13L6 15H3z" /><path d="M14.5 9.5l5 5M19.5 9.5l-5 5" />',
  soundOn:
    '<path d="M3 9h3l4-3.5v13L6 15H3z" /><path d="M14 9a4 4 0 0 1 0 6M16.5 6.5a7.5 7.5 0 0 1 0 11" />',
  camera:
    '<path d="M4 8h3l1.6-2h6.8L17 8h3v10H4z" /><circle cx="12" cy="12.8" r="3.2" />',
};

function button(title: string, icon: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'corner-button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18">${icon}</svg>`;
  return b;
}

/** The two quiet buttons beside the time arc: sound on/off and photo mode. */
export function createCornerButtons(handlers: { sound(on: boolean): void; photo(): void }): HTMLElement {
  const root = document.createElement('div');
  root.className = 'corner-buttons';
  let on = false;
  const sound = button('Sound', ICONS.soundOff);
  sound.addEventListener('click', () => {
    on = !on;
    sound.querySelector('svg')!.innerHTML = on ? ICONS.soundOn : ICONS.soundOff;
    sound.classList.toggle('on', on);
    handlers.sound(on);
  });
  const photo = button('Photo mode (P)', ICONS.camera);
  photo.addEventListener('click', () => handlers.photo());
  root.append(sound, photo);
  document.body.appendChild(root);
  return root;
}
