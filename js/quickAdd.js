import { setupAddWordModal } from './components/AddWordModal.js?v=18300';

const composer = setupAddWordModal({ onClose: () => window.close() });
window.addEventListener('focus', () => composer.open());
composer.open();
