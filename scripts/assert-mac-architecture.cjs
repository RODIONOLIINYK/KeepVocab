const { Arch } = require('builder-util');

module.exports = function assertMacArchitecture({ electronPlatformName, arch }) {
  if (['darwin', 'mas'].includes(electronPlatformName) && arch !== Arch.arm64) {
    throw new Error('KeepVocab macOS builds support Apple Silicon (arm64) only. Intel and universal builds are disabled.');
  }
};
