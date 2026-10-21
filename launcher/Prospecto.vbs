' Ouvre Prospecto sans fenetre de console (raccourci du bureau Windows).
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
extra = ""
If WScript.Arguments.Count > 0 Then extra = " " & WScript.Arguments(0)
shell.CurrentDirectory = root
shell.Run "node """ & root & "\launcher\launcher.js""" & extra, 0, False
