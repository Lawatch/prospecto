Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
shell.Run "node """ & root & "\launcher\launcher.js"" --stop", 0, True
MsgBox "Prospecto est arrêté.", 64, "Prospecto"
