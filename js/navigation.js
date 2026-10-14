document.querySelectorAll('.menu-toggle').forEach(button => {
  const header = button.closest('.site-header');
  const navigation = header?.querySelector('.main-nav');
  if (!header || !navigation) return;

  button.setAttribute('aria-controls', navigation.id);
  button.setAttribute('aria-expanded', 'false');

  const closeMenu = () => {
    header.classList.remove('menu-open');
    button.setAttribute('aria-expanded', 'false');
  };

  button.addEventListener('click', () => {
    const isOpen = header.classList.toggle('menu-open');
    button.setAttribute('aria-expanded', String(isOpen));
  });
  navigation.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeMenu();
  });
});
