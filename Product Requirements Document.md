# KGSM Web Admin Panel

---

A website that allows control over KGSM game server instances built with React and TypeScript.

## Requirements

### Hardware

- The site is developed and deployed on a Arch linux machine.
- It will run behind Nginx.

### Interoperability

- Interoperability is done through a service layer, which will be in charge of calling KGSM directly.
- The site must be able to interop with `kgsm` directly.
- No mocks should be used at any moment when interacting with `kgsm`.

### KGSM

- `kgsm` is a bash cli program that helps with the creation of dedicated game servers on linux (https://github.com/TheKrystalShip/KGSM)
- `kgsm` is available as a global system command
- `kgsm` can be invoked at any moment to fetch or send data

- `kgsm --help` shows the available commands and possible parameters:

  - ```
      Krystal Game Server Manager - 1.7.3

      Create, install, and manage game servers on Linux.

      If you have any problems while using KGSM, please don't hesitate to create an
      issue on GitHub: https://github.com/TheKrystalShip/KGSM/issues

      Usage:
      kgsm OPTION

      Options:
      General
      -h, --help                  Print this help message.
          [--interactive]           Print help information for interactive mode.
      --update                    Update KGSM to the latest version.
          [--force]                 Ignore version check and download the latest
                                  version available.
      --update-config             Update config.ini with the latest options added
                                  or modified in config.default.ini
      --ip                        Print the external server IP address.
      -v, --version               Print the KGSM version.

      Blueprints
      --create-blueprint          Create a new blueprints file.
          [-h, --help]              Print help information about the blueprint
                                  creation process.
      --blueprints                List all available blueprints.
      --blueprints --json         Print a JSON array with all blueprints.
      --blueprints --json --detailed
                                  Print a detailed JSON formatted Map with
                                  information on all blueprints.
      --install BLUEPRINT         Run the installation process for an existing
                                  blueprint.
                                  BLUEPRINT must be the name of a blueprint.
                                  Run --blueprints to see available options.
          [--install-dir <dir>]     Needed in case KGSM_DEFAULT_INSTALL_DIR is not
                                  set.
          [--version <version>]     WARNING: Not used by game servers that come from
                                  steamcmd, only used by custom game servers.
                                  Specific version to install.
          [--id <id>]               Identifier for the instance as an alternative
                                  from letting KGSM generate one.

      Instances
      --uninstall <instance>      Run the uninstall process for an instance.
      --instances [blueprint]     List all installed instances.
      --instances --json          Print a JSON formatted array with all instances.
      --instances --json --detailed
                                  Print a detailed JSON Map with all instances
                                  and their information.
                                  Optionally a blueprint name can be specified in
                                  order to only list instances of that blueprint

      -i, --instance <x> OPTION   Interact with an instance.
                                  OPTION represents one of the following:

          --logs                    Print a constant output of an instance's log.
          --status                  Return a detailed running status.
          --info                    Print information about the instance.
          --is-active               Check if the instance is active.
          --start                   Start the instance.
          --stop                    Stop the instance.
          --restart                 Restart the instance.
          --save                    Issues the save command to the instance.
          --input <command>         Send a command to the instance's interactive
                                  console, if the instance accepts commands.
                                  Will display the last 10 lines of the instance
                                  log.
          -v, --version             Provide version information.
                                  Running this with no other argument has the same
                                  outcome as adding the --installed argument.
          [--installed]           Print the currently installed version.
          [--latest]              Print the latest available version.
          --backups                 Print a list of created backups.
          --check-update            Check if a new version is available.
          --update                  Run the update process.
          --create-backup           Create a backup of the currently installed
                                  version, if any.
          --restore-backup NAME     Restore a backup.
                                  NAME is the backup name.
          --modify                  Modify and existing instance.
          --add OPTION            Add additional functionality. Possible options:
                                      ufw, systemd
          --remove OPTION         Remove functionality. Possible options:
                                      ufw, systemd
    ```

- `kgsm --instances --detailed --json` will return a JSON formatted list of instances with their data structure:

  - ```json
    {
      "barotrauma": {
        "Name": "barotrauma",
        "LifecycleManager": "systemd",
        "Status": "inactive",
        "PID": "None",
        "LogsDirectory": "None",
        "Directory": "/opt/barotrauma",
        "InstallationDate": "2024-10-22T20:11:13",
        "Version": "16097163",
        "Blueprint": "/opt/kgsm/blueprints/barotrauma.bp",
        "ServiceFile": "/etc/systemd/system/barotrauma.service",
        "SocketFile": "/opt/barotrauma/.barotrauma.stdin",
        "FirewallRule": ""
      },
      "corekeeper": {
        "Name": "corekeeper",
        "LifecycleManager": "systemd",
        "Status": "inactive",
        "PID": "None",
        "LogsDirectory": "None",
        "Directory": "/opt/corekeeper",
        "InstallationDate": "2024-10-22T20:11:26",
        "Version": "16050194",
        "Blueprint": "/opt/kgsm/blueprints/corekeeper.bp",
        "ServiceFile": "/etc/systemd/system/corekeeper.service",
        "SocketFile": "/opt/corekeeper/.corekeeper.stdin",
        "FirewallRule": ""
      },
      "factorio": {
        "Name": "factorio",
        "LifecycleManager": "systemd",
        "Status": "inactive",
        "PID": "None",
        "LogsDirectory": "None",
        "Directory": "/opt/factorio",
        "InstallationDate": "2025-05-06T13:10:31",
        "Version": "2.0.47",
        "Blueprint": "/opt/kgsm/blueprints/factorio.bp",
        "ServiceFile": "/etc/systemd/system/factorio.service",
        "SocketFile": "/opt/factorio/.factorio.stdin",
        "FirewallRule": ""
      },
      "minecraft-bmc3": {
        "Name": "minecraft-bmc3",
        "LifecycleManager": "systemd",
        "Status": "inactive",
        "PID": "None",
        "LogsDirectory": "None",
        "Directory": "/opt/minecraft-bmc3",
        "InstallationDate": "2025-03-15T14:07:54",
        "Version": "1.21.1",
        "Blueprint": "/opt/kgsm/blueprints/minecraft.bp",
        "ServiceFile": "/etc/systemd/system/minecraft-bmc3.service",
        "SocketFile": "/opt/minecraft-bmc3/.minecraft-bmc3.stdin",
        "FirewallRule": ""
      },
      "minecraft": {
        "Name": "minecraft",
        "LifecycleManager": "systemd",
        "Status": "inactive",
        "PID": "None",
        "LogsDirectory": "None",
        "Directory": "/opt/minecraft",
        "InstallationDate": "2024-10-22T20:11:57",
        "Version": "1.21.2",
        "Blueprint": "/opt/kgsm/blueprints/minecraft.bp",
        "ServiceFile": "/etc/systemd/system/minecraft.service",
        "SocketFile": "/opt/minecraft/.minecraft.stdin",
        "FirewallRule": ""
      },
      "minecraft-mmc3": {
        "Name": "minecraft-mmc3",
        "LifecycleManager": "systemd",
        "Status": "inactive",
        "PID": "None",
        "LogsDirectory": "None",
        "Directory": "/opt/minecraft-mmc3",
        "InstallationDate": "2025-03-23T19:42:22",
        "Version": "1.21.1",
        "Blueprint": "/opt/kgsm/blueprints/minecraft.bp",
        "ServiceFile": "/etc/systemd/system/minecraft-mmc3.service",
        "SocketFile": "/opt/minecraft-mmc3/.minecraft-mmc3.stdin",
        "FirewallRule": ""
      },
      "projectzomboid": {
        "Name": "projectzomboid",
        "LifecycleManager": "systemd",
        "Status": "inactive",
        "PID": "None",
        "LogsDirectory": "None",
        "Directory": "/opt/projectzomboid",
        "InstallationDate": "2024-10-22T20:12:25",
        "Version": "10105838",
        "Blueprint": "/opt/kgsm/blueprints/projectzomboid.bp",
        "ServiceFile": "/etc/systemd/system/projectzomboid.service",
        "SocketFile": "/opt/projectzomboid/.projectzomboid.stdin",
        "FirewallRule": ""
      },
      "terraria": {
        "Name": "terraria",
        "LifecycleManager": "systemd",
        "Status": "inactive",
        "PID": "None",
        "LogsDirectory": "None",
        "Directory": "/opt/terraria",
        "InstallationDate": "2024-12-25T22:57:05",
        "Version": "1449",
        "Blueprint": "/opt/kgsm/blueprints/terraria.bp",
        "ServiceFile": "/etc/systemd/system/terraria.service",
        "SocketFile": "/opt/terraria/.terraria.stdin",
        "FirewallRule": ""
      },
      "valheim": {
        "Name": "valheim",
        "LifecycleManager": "systemd",
        "Status": "inactive",
        "PID": "None",
        "LogsDirectory": "None",
        "Directory": "/opt/valheim",
        "InstallationDate": "2025-01-23T23:04:47",
        "Version": "16375469",
        "Blueprint": "/opt/kgsm/blueprints/valheim.bp",
        "ServiceFile": "/etc/systemd/system/valheim.service",
        "SocketFile": "/opt/valheim/.valheim.stdin",
        "FirewallRule": ""
      },
      "veloren": {
        "Name": "veloren",
        "LifecycleManager": "systemd",
        "Status": "inactive",
        "PID": "None",
        "LogsDirectory": "None",
        "Directory": "/opt/veloren",
        "InstallationDate": "2024-10-22T20:13:21",
        "Version": "weekly",
        "Blueprint": "/opt/kgsm/blueprints/veloren.bp",
        "ServiceFile": "/etc/systemd/system/veloren.service",
        "SocketFile": "/opt/veloren/.veloren.stdin",
        "FirewallRule": ""
      }
    }
    ```

- `kgsm --blueprints --detailed --json` will return a JSON formatted list of blueprints:
  - ```json
    {
      "7dtd.bp": {
        "Name": "7dtd",
        "Port": "26900:26903/tcp|26900:26903/udp",
        "AppId": "294420",
        "SteamAccountRequired": "0",
        "LaunchBin": "7DaysToDieServer.x86_64",
        "LevelName": "tks",
        "InstallSubdirectory": "",
        "LaunchArgs": "-quit -batchmode -nographics -headless -dedicated -configfile=/serverconfig.xml",
        "StopCommand": "",
        "SaveCommand": ""
      },
      "ark.bp": {
        "Name": "ark",
        "Port": "27015/udp|7777/udp|7778/udp|27020/tcp",
        "AppId": "376030",
        "SteamAccountRequired": "0",
        "LaunchBin": "ShooterGameServer",
        "LevelName": "default",
        "InstallSubdirectory": "ShooterGame/Binaries/Linux",
        "LaunchArgs": "TheIsland?listen?SessionName= -server -log",
        "StopCommand": "",
        "SaveCommand": ""
      },
      "barotrauma.bp": {
        "Name": "barotrauma",
        "Port": "27015/udp|27016/udp",
        "AppId": "1026340",
        "SteamAccountRequired": "0",
        "LaunchBin": "DedicatedServer",
        "LevelName": "default",
        "InstallSubdirectory": "",
        "LaunchArgs": "",
        "StopCommand": "",
        "SaveCommand": ""
      },
      "corekeeper.bp": {
        "Name": "corekeeper",
        "Port": "22420",
        "AppId": "1963720",
        "SteamAccountRequired": "0",
        "LaunchBin": "_launch.sh",
        "LevelName": "default",
        "InstallSubdirectory": "",
        "LaunchArgs": "",
        "StopCommand": "",
        "SaveCommand": ""
      },
      "cssource.bp": {
        "Name": "cssource",
        "Port": "27015/tcp|27015/udp|27020/udp|27005/udp|26900/udp",
        "AppId": "232330",
        "SteamAccountRequired": "0",
        "LaunchBin": "srcds_run",
        "LevelName": "de_dust",
        "InstallSubdirectory": "",
        "LaunchArgs": "-console -game cstrike -secure +maxplayers 22 +map ",
        "StopCommand": "exit",
        "SaveCommand": ""
      },
      "dontstarvetogether.bp": {
        "Name": "dontstarvetogether",
        "Port": "10999/tcp|10999/udp",
        "AppId": "343050",
        "SteamAccountRequired": "0",
        "LaunchBin": "dontstarve_dedicated_server_nullrenderer_x64",
        "LevelName": "default",
        "InstallSubdirectory": "bin64",
        "LaunchArgs": "-persistent_storage_root  -conf_dir dstserver_config -console",
        "StopCommand": "c_shutdown()",
        "SaveCommand": "c_save()"
      },
      "factorio.bp": {
        "Name": "factorio",
        "Port": "34197",
        "AppId": "0",
        "SteamAccountRequired": "0",
        "LaunchBin": "factorio",
        "LevelName": "default",
        "InstallSubdirectory": "bin/x64",
        "LaunchArgs": "--start-server /",
        "StopCommand": "/quit",
        "SaveCommand": "/save"
      },
      "gmod.bp": {
        "Name": "gmod",
        "Port": "27015:27016/udp|27036/tcp",
        "AppId": "4020",
        "SteamAccountRequired": "0",
        "LaunchBin": "srcds_run",
        "LevelName": "gm_construct",
        "InstallSubdirectory": "",
        "LaunchArgs": "-console +gamemode sandbox +maxplayers 32 +map ",
        "StopCommand": "exit",
        "SaveCommand": ""
      },
      "killingfloor2.bp": {
        "Name": "killingfloor2",
        "Port": "7777/udp|27015/udp|8080/tcp|20560/udp",
        "AppId": "232130",
        "SteamAccountRequired": "0",
        "LaunchBin": "KFGameSteamServer.bin.x86_64",
        "LevelName": "kf-bioticslab",
        "InstallSubdirectory": "Binaries/Win64",
        "LaunchArgs": "",
        "StopCommand": "",
        "SaveCommand": ""
      },
      "killingfloor.bp": {
        "Name": "killingfloor",
        "Port": "7707:7708/udp|7717/udp|28852|8075/tcp|20560/udp",
        "AppId": "215360",
        "SteamAccountRequired": "1",
        "LaunchBin": "ucc-bin",
        "LevelName": "default",
        "InstallSubdirectory": "System",
        "LaunchArgs": "server KF-bioticslab.rom?game=KFmod.KFGameType?VACSecured=true?MaxPlayers=6 -nohomedir",
        "StopCommand": "",
        "SaveCommand": ""
      },
      "left4dead2.bp": {
        "Name": "left4dead2",
        "Port": "27015:27020/udp",
        "AppId": "222860",
        "SteamAccountRequired": "0",
        "LaunchBin": "srcds_run",
        "LevelName": "c1m1_hotel",
        "InstallSubdirectory": "",
        "LaunchArgs": "-console -game left4dead2 +map ",
        "StopCommand": "exit",
        "SaveCommand": ""
      },
      "left4dead.bp": {
        "Name": "left4dead",
        "Port": "27015:27020/udp",
        "AppId": "222840",
        "SteamAccountRequired": "0",
        "LaunchBin": "srcds_run",
        "LevelName": "l4d_hospital01_apartment",
        "InstallSubdirectory": "",
        "LaunchArgs": "-console -game left4dead +map  +maxplayers 4",
        "StopCommand": "exit",
        "SaveCommand": ""
      },
      "lotrrtm.bp": {
        "Name": "lotrrtm",
        "Port": "",
        "AppId": "3349480",
        "SteamAccountRequired": "0",
        "LaunchBin": "",
        "LevelName": "default",
        "InstallSubdirectory": "",
        "LaunchArgs": "",
        "StopCommand": "",
        "SaveCommand": ""
      },
      "minecraft.bp": {
        "Name": "minecraft",
        "Port": "25565/udp",
        "AppId": "0",
        "SteamAccountRequired": "0",
        "LaunchBin": "java",
        "LevelName": "default",
        "InstallSubdirectory": "",
        "LaunchArgs": "-Xmx4096M -Xms4096M -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1 -jar release.jar nogui",
        "StopCommand": "/stop",
        "SaveCommand": "/save-all"
      },
      "necesse.bp": {
        "Name": "necesse",
        "Port": "14159/tcp|14159/udp",
        "AppId": "1169370",
        "SteamAccountRequired": "0",
        "LaunchBin": "StartServer-nogui.sh",
        "LevelName": "default",
        "InstallSubdirectory": "",
        "LaunchArgs": "-world  -localdir",
        "StopCommand": "",
        "SaveCommand": ""
      },
      "projectzomboid.bp": {
        "Name": "projectzomboid",
        "Port": "16261:16262/udp",
        "AppId": "380870",
        "SteamAccountRequired": "0",
        "LaunchBin": "start-server.sh",
        "LevelName": "default",
        "InstallSubdirectory": "",
        "LaunchArgs": "-servername  -cachedir=",
        "StopCommand": "quit",
        "SaveCommand": "save"
      },
      "starbound.bp": {
        "Name": "starbound",
        "Port": "21025/tcp|21025/udp",
        "AppId": "211820",
        "SteamAccountRequired": "1",
        "LaunchBin": "starbound_server",
        "LevelName": "default",
        "InstallSubdirectory": "linux",
        "LaunchArgs": "",
        "StopCommand": "",
        "SaveCommand": ""
      },
      "starmade.bp": {
        "Name": "starmade",
        "Port": "4242/tcp|4242/udp",
        "AppId": "335180",
        "SteamAccountRequired": "1",
        "LaunchBin": "java",
        "LevelName": "tks",
        "InstallSubdirectory": "StarMade",
        "LaunchArgs": "-Xms4G -Xmx4G -jar StarMade.jar -server",
        "StopCommand": "",
        "SaveCommand": ""
      },
      "terraria.bp": {
        "Name": "terraria",
        "Port": "7777/tcp|7777/udp",
        "AppId": "0",
        "SteamAccountRequired": "0",
        "LaunchBin": "TerrariaServer.bin.x86_64",
        "LevelName": "default",
        "InstallSubdirectory": "",
        "LaunchArgs": "-port  -world / -autocreate 3 -worldname ",
        "StopCommand": "exit",
        "SaveCommand": "save"
      },
      "unturned.bp": {
        "Name": "unturned",
        "Port": "27015:27016/tcp|27015:27016/udp",
        "AppId": "1110390",
        "SteamAccountRequired": "0",
        "LaunchBin": "ServerHelper.sh",
        "LevelName": "default",
        "InstallSubdirectory": "",
        "LaunchArgs": "+InternetServer/",
        "StopCommand": "shutdown",
        "SaveCommand": "save"
      },
      "valheim.bp": {
        "Name": "valheim",
        "Port": "2456:2458/tcp|2456:2458/udp",
        "AppId": "896660",
        "SteamAccountRequired": "0",
        "LaunchBin": "start_server_bepinex.sh",
        "LevelName": "tks",
        "InstallSubdirectory": "",
        "LaunchArgs": "",
        "StopCommand": "",
        "SaveCommand": ""
      },
      "veloren.bp": {
        "Name": "veloren",
        "Port": "14004/tcp|14004/udp",
        "AppId": "0",
        "SteamAccountRequired": "0",
        "LaunchBin": "veloren-server-cli",
        "LevelName": "default",
        "InstallSubdirectory": "",
        "LaunchArgs": "",
        "StopCommand": "",
        "SaveCommand": ""
      }
    }
    ```

### Website functionality

- The users should be able to authenticate with third party accounts like Microsoft, Google and GitHub, no local accounts are allowed.
- A authentication bypass should be in place for local development, so that no account login is required.
- The website should not require a database or any sort of permanent storage solution and should not store anything on the server side if it can be avoided.
- The homepage dashboard should have different sections:
  - A section for available blueprint that can be used to create new instances.
  - A section with currently installed instance and their current state (Running, Stopped).
  - A section with system graphs to show resource usage.

### Website design

- The interface should be modern, clean with emphasis on usability.
- There must be a toggle for white and dark theme for the entire website.
- Dark mode should be very prominent throughout the design of the website, avoid bright colors for big elements as much as possible.
- Avoid using CSS frameworks, vanilla CSS will do just fine.
- The design must be responsive, and it should make use of the space efficiently on big screens/resolutions like 4k.

### Graphs

- The home page should display a dashboard with statistics like CPU usage, Memory usage, Disk space used/free.
- Graphs should be live updating with detailed historical information and statistics like highest, lowest, average.
- History should be kept around peak usage metrics in order to determine the cause at a later date.
- The graphs should be colored with different colors depending on the graphs.
- The graphs should allow the user to select different time-frames, like 10 seconds, 1 minute, 5 minutes, 1 hour, 24 hours.
- CPU graph should show percentage usage, from 0% to 100%
- Memory graph show show Memory usage in GB or MB, total system memory, memory used and free memory, in human readable format.
- Disk space graph should show total storage space, used storage space and free storage space, in GB in a human readable format.
- Network graph should display network traffic and ping to the user connected to the website.

### KGSM Blueprints

- The dashboard should include a section at the top, like a carousel, to display all the available blueprint from which instances can be created
- Each blueprint should display the game case cover, like Steam's library.
- Hovering over a blueprint should display an animation to indicate focus.
- Clicking on a blueprint should show a popup window with a small form that allows the user to create a new instance from it.

### KGSM Instances

- The dashboard should show the currently available game instances, the ones that are installed through KGSM.
- Each instance should show some basic information about them, like install date, instance id, install location, installed version, etc.
- Each instance should have buttons that allow for Starting, Stopping, Restarting and Uninstalling the instance, each button colored accordingly.
- Uninstalling should prompt the user for confirmation through a popup or an alert.
- Clicking on an instance should open a popup window, with live logs and an input that can be used to sent commands to the instance.
- The design of the popup window should resemble a terminal window
