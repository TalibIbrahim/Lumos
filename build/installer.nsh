!macro customInit
  WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" KeepShortcuts "true"
!macroend

!macro customInstall
  StrCpy $launchLink "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
!macroend
