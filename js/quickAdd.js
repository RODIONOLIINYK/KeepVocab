import { setupAddWordModal } from './components/AddWordModal.js?v=18908';
import { initializeImageLearning } from './services/imageLearning.js?v=18908';
import { preloadMeaningModel } from './services/meaningReference.js';

const composer = setupAddWordModal({ onClose: () => window.close() });
window.addEventListener('focus', () => composer.open());
composer.open();
void initializeImageLearning().catch(() => {});
void preloadMeaningModel().catch(() => {});
