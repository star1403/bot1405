' ============================================================
' SmartChef Launcher with Auto-Cleanup
' Version 5.1 - Compatible with Hardened Server
' ============================================================
' Server runs in MINIMIZED window (visible on taskbar)
' Client runs in NORMAL window (main panel)
' When client closes, server is killed automatically
' ============================================================

Option Explicit

Dim fso, shell, scriptDir, serverDir, clientDir
Dim serverCmd, clientCmd

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
serverDir = scriptDir & "\server"
clientDir = scriptDir & "\client"

' Verify folders exist
If Not fso.FolderExists(serverDir) Then
    MsgBox "ERROR: 'server' folder not found!" & vbCrLf & _
           "Expected at: " & serverDir, vbCritical, "SmartChef"
    WScript.Quit 1
End If

If Not fso.FolderExists(clientDir) Then
    MsgBox "ERROR: 'client' folder not found!" & vbCrLf & _
           "Expected at: " & clientDir, vbCritical, "SmartChef"
    WScript.Quit 1
End If

' Check .env exists
If Not fso.FileExists(serverDir & "\.env") Then
    MsgBox "ERROR: .env file not found in server folder!" & vbCrLf & _
           "Copy .env.example to .env and fill the values.", vbCritical, "SmartChef"
    WScript.Quit 1
End If

' ============================================================
' STEP 1: Kill only previous SmartChef node processes (safer)
' ============================================================
On Error Resume Next
' Kill by window title first (precise - does not kill other node apps)
shell.Run "taskkill /FI ""WINDOWTITLE eq SmartChef-Server*"" /F /T", 0, True
shell.Run "taskkill /FI ""WINDOWTITLE eq SmartChef-Client*"" /F /T", 0, True
On Error GoTo 0

WScript.Sleep 1200

' ============================================================
' STEP 2: Start server in MINIMIZED window (7 = minimized)
' ============================================================
serverCmd = "cmd /c title SmartChef-Server && cd /d """ & serverDir & """ && node server.js"
shell.Run serverCmd, 7, False

' ============================================================
' STEP 3: Wait for server to become ready (max 30 seconds)
' ============================================================
Dim waited, isReady
waited = 0
isReady = False

Do While waited < 30
    WScript.Sleep 1000
    waited = waited + 1

    On Error Resume Next
    Dim http
    Set http = CreateObject("MSXML2.XMLHTTP")
    http.Open "GET", "http://localhost:3000/health", False
    http.Send
    If http.Status = 200 Then
        isReady = True
        Exit Do
    End If
    On Error GoTo 0
Loop

If Not isReady Then
    MsgBox "Server did not start within 30 seconds." & vbCrLf & vbCrLf & _
           "Please check:" & vbCrLf & _
           "1. Node.js is installed (node -v)" & vbCrLf & _
           "2. .env file is configured correctly" & vbCrLf & _
           "3. ENCRYPTION_KEY and JWT_SECRET are at least 32 characters" & vbCrLf & _
           "4. No other process is using port 3000" & vbCrLf & vbCrLf & _
           "Look at the minimized 'SmartChef-Server' window for error messages.", _
           vbCritical, "SmartChef - Server Failed"
    WScript.Quit 1
End If

' ============================================================
' STEP 4: Open client panel in NORMAL window
' ============================================================
clientCmd = "cmd /k title SmartChef-Client && cd /d """ & clientDir & """ && node client.js"
shell.Run clientCmd, 1, False

' ============================================================
' STEP 5: Wait for client window to close
' ============================================================
Dim clientAlive, loopCounter
clientAlive = True
loopCounter = 0

Do While clientAlive
    WScript.Sleep 2000
    loopCounter = loopCounter + 1

    On Error Resume Next
    Dim wmi, query, processes
    Set wmi = GetObject("winmgmts:\\.\root\cimv2")
    query = "SELECT * FROM Win32_Process WHERE CommandLine LIKE '%SmartChef-Client%'"
    Set processes = wmi.ExecQuery(query)

    If Err.Number = 0 Then
        If processes.Count = 0 Then
            clientAlive = False
        End If
    End If
    Err.Clear
    On Error GoTo 0

    ' Safety: auto-exit after 24 hours
    If loopCounter > 43200 Then
        clientAlive = False
    End If
Loop

' ============================================================
' STEP 6: Kill only SmartChef processes (safer than killing all node)
' ============================================================
WScript.Sleep 1500

On Error Resume Next
shell.Run "taskkill /FI ""WINDOWTITLE eq SmartChef-Server*"" /F /T", 0, True
shell.Run "taskkill /FI ""WINDOWTITLE eq SmartChef-Client*"" /F /T", 0, True
On Error GoTo 0

WScript.Quit 0
