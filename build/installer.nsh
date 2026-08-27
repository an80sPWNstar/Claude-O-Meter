; Claude-O-Meter installer: an assisted install, not a one-click drop.
;
; The app reads credentials off the machine, so the person installing it gets
; told that in plain words (the licence page carries build/access-notice.txt)
; and then chooses how much access it gets, before a single file is read. The
; choice is written next to the app's settings and consumed on first launch.

; NSIS compiles this file twice: once for the installer, once for the
; uninstaller. The uninstaller pass expands none of these macros, so every Var
; here would be "not referenced" -- warning 6001, which electron-builder treats
; as a build failure. Nothing in this file has anything to say about uninstalling.
!ifndef BUILD_UNINSTALLER

!include nsDialogs.nsh
!include LogicLib.nsh

Var AccessRadioAuto
Var AccessRadioManual
Var AccessRadioBrowser
Var AccessPathLabel
Var AccessPathBox
Var AccessBrowseButton
Var AccessMode
Var AccessPath
Var AccessSummary

; The page functions live inside the macro on purpose: the custom include is
; pulled in before MUI2.nsh, so MUI_HEADER_TEXT does not exist yet at file
; scope. The macro is expanded further down, where it does.
!macro customPageAfterChangeDir
  Page custom ClaudeAccessPageCreate ClaudeAccessPageLeave

  Function ClaudeAccessPageCreate
    !insertmacro MUI_HEADER_TEXT "Account access" "Choose how Claude-O-Meter reaches your Claude account."

    nsDialogs::Create 1018
    ; $0 rather than a dedicated Var: the handle is only tested for error here,
    ; and an unused Var trips NSIS warning 6001 during the uninstaller pass,
    ; where none of these page functions are compiled in.
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 22u "Nothing has been read yet. Claude-O-Meter will only do what you pick here, and you can change it later in the app's Settings."
    Pop $0

    ${NSD_CreateRadioButton} 0 26u 100% 11u "Find it automatically (recommended)"
    Pop $AccessRadioAuto
    ${NSD_CreateLabel} 12u 38u 95% 26u "Looks for the login Claude Code saves on this computer: the .claude folder, a folder named by CLAUDE_CONFIG_DIR, the standard app-data folders, and - only if none of those has one - running WSL distributions."
    Pop $0

    ${NSD_CreateRadioButton} 0 68u 100% 11u "Point me at the file"
    Pop $AccessRadioManual
    ${NSD_CreateLabel} 12u 80u 95% 9u "Reads one file that you name, and nothing else on disk."
    Pop $0

    ${NSD_CreateLabel} 12u 92u 20u 12u "File:"
    Pop $AccessPathLabel
    ${NSD_CreateText} 34u 90u 60% 12u "$AccessPath"
    Pop $AccessPathBox
    ${NSD_CreateButton} 78% 90u 20% 12u "Browse..."
    Pop $AccessBrowseButton
    ${NSD_OnClick} $AccessBrowseButton ClaudeAccessBrowse

    ${NSD_CreateRadioButton} 0 108u 100% 11u "Sign in through claude.ai instead"
    Pop $AccessRadioBrowser
    ${NSD_CreateLabel} 12u 120u 95% 9u "Reads no files at all. A sign-in window opens the first time you run the app."
    Pop $0

    ${NSD_OnClick} $AccessRadioAuto ClaudeAccessSync
    ${NSD_OnClick} $AccessRadioManual ClaudeAccessSync
    ${NSD_OnClick} $AccessRadioBrowser ClaudeAccessSync

    ; Default the first time through; afterwards keep whatever the user picked,
    ; so stepping Back and Next again does not silently reset the choice.
    ${If} $AccessMode == "manual"
      ${NSD_Check} $AccessRadioManual
    ${ElseIf} $AccessMode == "browser"
      ${NSD_Check} $AccessRadioBrowser
    ${Else}
      ${NSD_Check} $AccessRadioAuto
    ${EndIf}

    Call ClaudeAccessSync
    nsDialogs::Show
  FunctionEnd

  ; The file row is only live while "Point me at the file" is the choice.
  Function ClaudeAccessSync
    ${NSD_GetState} $AccessRadioManual $0
    ${If} $0 == ${BST_CHECKED}
      EnableWindow $AccessPathBox 1
      EnableWindow $AccessBrowseButton 1
      EnableWindow $AccessPathLabel 1
    ${Else}
      EnableWindow $AccessPathBox 0
      EnableWindow $AccessBrowseButton 0
      EnableWindow $AccessPathLabel 0
    ${EndIf}
  FunctionEnd

  Function ClaudeAccessBrowse
    Pop $0
    nsDialogs::SelectFileDialog open "$PROFILE\.claude\.credentials.json" "Credentials file (.credentials.json)|.credentials.json|All files (*.*)|*.*"
    Pop $0
    ${If} $0 != ""
      ${NSD_SetText} $AccessPathBox "$0"
    ${EndIf}
  FunctionEnd

  Function ClaudeAccessPageLeave
    ${NSD_GetState} $AccessRadioManual $0
    ${If} $0 == ${BST_CHECKED}
      ${NSD_GetText} $AccessPathBox $AccessPath
      ${If} $AccessPath == ""
        MessageBox MB_OK|MB_ICONEXCLAMATION "Choose the credentials file, or pick one of the other two options."
        Abort
      ${EndIf}
      StrCpy $AccessMode "manual"
      StrCpy $AccessSummary "reads only $AccessPath"
      Return
    ${EndIf}

    ${NSD_GetState} $AccessRadioBrowser $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $AccessMode "browser"
      StrCpy $AccessPath ""
      StrCpy $AccessSummary "reads no files - you will sign in through claude.ai"
      Return
    ${EndIf}

    StrCpy $AccessMode "auto"
    StrCpy $AccessPath ""
    StrCpy $AccessSummary "will look for your Claude Code login in the usual places"
  FunctionEnd
!macroend

; Written as key=value rather than JSON so a Windows path with backslashes
; needs no escaping on either side of the handoff. main.js reads this once,
; folds it into settings.json, and deletes it.
!macro customInstall
  CreateDirectory "$APPDATA\claude-o-meter"
  FileOpen $0 "$APPDATA\claude-o-meter\install-prefs.txt" w
  FileWrite $0 "accessMode=$AccessMode$\r$\n"
  FileWrite $0 "credentialPath=$AccessPath$\r$\n"
  FileClose $0
!macroend

; Defined at file scope, not inside customHeader: that macro is inserted after
; the pages are declared, which is too late for the finish page to read it. The
; $-variables expand at run time, so the summary reflects what was actually
; chosen two pages earlier.
!define MUI_FINISHPAGE_TITLE "Claude-O-Meter is installed"
!define MUI_FINISHPAGE_TEXT "Installed to $INSTDIR.$\r$\n$\r$\nAccount access: the app $AccessSummary. Change it any time in the app under Settings, where the same three choices are spelled out in full.$\r$\n$\r$\nNothing has been read yet, and nothing has been sent anywhere. The only network request this app ever makes is asking Anthropic for your own usage figures."

!endif
