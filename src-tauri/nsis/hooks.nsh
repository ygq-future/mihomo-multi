; NSIS installer/uninstaller hooks for Mihomo Multi CLI registration.
; Delegates directly to the bundled `mihomo-multi-cli.exe` binary so there is zero
; shell-quoting fragility and custom aliases are preserved across upgrades.

!macro NSIS_HOOK_POSTINSTALL
  nsExec::ExecToLog '"$INSTDIR\mihomo-multi-cli.exe" __nsis-install'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  nsExec::ExecToLog '"$INSTDIR\mihomo-multi-cli.exe" __nsis-uninstall'
!macroend
