import { setupAddWordModal } from './components/AddWordModal.js?v=18904';
import { initializeImageLearning } from './services/imageLearning.js?v=18904';

const composer = setupAddWordModal({ onClose: () => window.close() });
window.addEventListener('focus', () => composer.open());
composer.open();
void initializeImageLearning().catch(() => {});
