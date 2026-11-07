# The bridge between the app's JavaScript and the "Add Expense" shortcut
# (BR-EXP-12). The shortcut itself is in `../intents/`, compiled into the app
# target by `../app.plugin.js`.
Pod::Spec.new do |s|
  s.name           = 'ExpenseShortcut'
  s.version        = '1.0.0'
  s.summary        = 'Shares the signed-in account with the Add Expense shortcut'
  s.license        = 'UNLICENSED'
  s.author         = 'Lumei'
  s.homepage       = 'https://github.com/totokunaga/lumei'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
