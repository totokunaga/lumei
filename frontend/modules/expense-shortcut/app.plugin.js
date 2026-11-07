// Adds the "Add Expense" shortcut (BR-EXP-12) to the iOS app target at
// prebuild. Shortcuts finds App Intents only when they are compiled into the
// app (or an extension), not into a CocoaPods library such as this module's
// own `ios/`, so the intent's files are copied next to `AppDelegate.swift`
// and added to the target, with their string catalog for Japanese and French.
const fs = require('node:fs');
const path = require('node:path');

const { IOSConfig, withDangerousMod, withXcodeProject } = require('expo/config-plugins');

/** The folder the files go in, inside the app's own, e.g. `ios/Lumei/ExpenseShortcut`. */
const FOLDER = 'ExpenseShortcut';

/** The files compiled into the app target, from this module's `intents/`. */
const SOURCES = ['App/AddExpenseIntent.swift', 'Sources/ExpenseStore/ExpenseStore.swift'];

/** The string catalog of the intent's text, from this module's `intents/`. */
const STRINGS = 'App/Localizable.xcstrings';

/** The languages the app is translated into besides English (BR-SET-01). */
const REGIONS = ['ja', 'fr'];

/**
 * Copies the intent's files into the generated iOS project.
 * @returns The config, with a step that runs when `ios/` is written.
 */
const withFiles = (config) =>
  withDangerousMod(config, [
    'ios',
    (config) => {
      const target = path.join(
        config.modRequest.platformProjectRoot,
        config.modRequest.projectName,
        FOLDER,
      );
      fs.mkdirSync(target, { recursive: true });
      for (const file of [...SOURCES, STRINGS]) {
        fs.copyFileSync(
          path.join(__dirname, 'intents', file),
          path.join(target, path.basename(file)),
        );
      }
      return config;
    },
  ]);

/**
 * Adds the copied files to the app target: the Swift files to its sources,
 * and the string catalog to its resources, which Xcode compiles into each
 * language's strings.
 * @returns The config, with the Xcode project changed.
 */
const withProject = (config) =>
  withXcodeProject(config, (config) => {
    const project = config.modResults;
    const name = config.modRequest.projectName;
    for (const file of SOURCES) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath: `${name}/${FOLDER}/${path.basename(file)}`,
        groupName: name,
        project,
      });
    }
    const strings = `${name}/${FOLDER}/${path.basename(STRINGS)}`;
    IOSConfig.XcodeUtils.addResourceFileToGroup({
      filepath: strings,
      groupName: name,
      isBuildFile: true,
      project,
    });
    // The xcode library doesn't know string catalogs, so it is named here.
    const references = project.pbxFileReferenceSection();
    for (const key of Object.keys(references)) {
      const reference = references[key];
      if (typeof reference === 'object' && String(reference.path).replace(/"/g, '') === strings) {
        reference.lastKnownFileType = 'text.json.xcstrings';
      }
    }
    for (const region of REGIONS) {
      project.addKnownRegion(region);
    }
    return config;
  });

/**
 * Adds the "Add Expense" App Intent to the iOS app (BR-EXP-12).
 * @returns The config with the intent's files and languages in the app target.
 */
module.exports = (config) => withProject(withFiles(config));
