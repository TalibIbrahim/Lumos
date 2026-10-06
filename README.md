# Lumos

<p align="center">
  <img src="src/renderer/src/assets/logo-lockup.svg" alt="Lumos Brand Lockup" width="300" />
</p>

<p align="center">
  <strong>Local-first desktop application for Tuya smart lights with Apple HomeKit bridge.</strong><br>
  Direct LAN control over TCP with sub-50ms latency, physical glass depth, and zero cloud runtime dependencies.
</p>

<p align="center">
  <img src="docs/screenshots/01_home_default_1080x740.png" alt="Lumos Home Screen" width="700" />
</p>

<p align="center">
  <img src="docs/screenshots/06_settings_sheet.png" alt="Lumos Settings & HomeKit" width="340" />
  <img src="docs/screenshots/07_light_detail_sheet.png" alt="Lumos Light Controls" width="340" />
</p>

---

## Features

- **Direct LAN Control**: Communicates directly with Tuya smart fixtures over local TCP (port 6668) with sub-50ms latency and no cloud dependencies at runtime.
- **Precision Lighting Controls**: Power toggle, granular brightness dimming (1-100%), thermodynamic color temperature (2200K warm candlelight to 6500K cool daylight), and full RGB/HSV chromatic disc.
- **Rooms & Spatial Organization**: Group lights by room with synchronized dimming and room-level master switches.
- **Atmospheric Scenes**: Quick looks for Reading, Relax, Focus, Night, and custom user-defined light presets.
- **Automations**: Time- and weekday-based schedules, progressive sleep timer, and gradual sunrise wake-up alarm.
- **Local Webhook Server**: Embedded HTTP webhook server (`127.0.0.1:8989`) with token authentication for incoming notifications and visual flash alerts.
- **Apple HomeKit Bridge**: Native embedded HomeKit Accessory Protocol (HAP) server via `hap-nodejs` to control fixtures from iOS, iPadOS, macOS, and watchOS.
- **System Tray & Quick Controls**: Background operation with quick toggles from the Windows system tray.
- **Modern Glass Interface**: Apple-inspired industrial design built with React Bits Glass Surface and responsive layout.

---

## Download and Install

Download the latest installer from the [Releases](https://github.com/TalibIbrahim/Lumos/releases) page:

- **Installer**: `Lumos-Setup-1.0.0.exe` (Windows 64-bit)

### Installation Steps

1. Download `Lumos-Setup-1.0.0.exe` from the latest release.
2. Run the installer.
3. **Windows SmartScreen Note**: Because the installer is self-signed/unsigned, Windows SmartScreen may display a warning screen. Click **More info**, then click **Run anyway** to proceed with installation.
4. Launch Lumos from your Start Menu or Desktop shortcut.

---

## Setup for Your Own Lights

Lumos controls Tuya and Smart Life compatible Wi-Fi lights over your local network. Follow these steps to generate your device configuration:

### Step 1: Pair Bulbs in Smart Life / Tuya Smart App
Ensure your bulbs are connected to your 2.4 GHz Wi-Fi network using the standard **Smart Life** or **Tuya Smart** mobile app.

### Step 2: Create a Tuya Cloud Developer Project
1. Register for a free account at the [Tuya IoT Platform](https://iot.tuya.com/).
2. Create a new **Cloud Project** (select **Smart Home** industry). Choose the Data Center that matches your mobile app account region.
3. Authorize the **IoT Core** and related authorization APIs for your project under **Service API**.
4. Link your mobile app account under **Devices** > **Link Tuya App Account** by scanning the displayed QR code with your Smart Life / Tuya Smart app.

### Step 3: Extract Device Keys with TinyTuya
Use the open-source [TinyTuya](https://github.com/jasonacox/tinytuya) tool to retrieve your local encryption keys and IP addresses:

```bash
pip install tinytuya
python -m tinytuya wizard
python -m tinytuya scan
```

The wizard will connect to your developer project, fetch the device names, IDs, and local keys, and output a `devices.json` file.

### Step 4: Import Configuration into Lumos
On first launch, Lumos presents an onboarding screen. You can:
- Drag and drop or browse to your generated `devices.json` file.
- Or manually place `devices.json` in the application data folder:
  - **Windows**: `%APPDATA%\Lumos\devices.json`
  - **macOS**: `~/Library/Application Support/Lumos/devices.json`
  - **Linux**: `~/.config/Lumos/devices.json`

### Device Configuration Format

The `devices.json` file follows the standard TinyTuya format. Example with placeholder values:

```json
[
  {
    "name": "Desk Lamp",
    "id": "bf0123456789abcdef0123",
    "key": "0123456789abcdef",
    "ip": "192.168.1.50",
    "mac": "00:11:22:33:44:55",
    "version": "3.3",
    "category": "dj",
    "mapping": {
      "20": { "code": "switch_led", "type": "Boolean" },
      "21": { "code": "work_mode", "type": "Enum" },
      "22": { "code": "bright_value_v2", "type": "Integer", "values": { "min": 10, "max": 1000 } },
      "23": { "code": "temp_value_v2", "type": "Integer", "values": { "min": 0, "max": 1000 } },
      "24": { "code": "colour_data_v2", "type": "Json" }
    }
  }
]
```

---

## Apple HomeKit Setup

Lumos includes an integrated HomeKit bridge that exposes your local fixtures as native HomeKit accessories.

1. Open Lumos and click the **Settings** gear icon in the titlebar.
2. In the **Apple HomeKit** section, note the QR code and the 8-digit setup code (formatted `XXX-XX-XXX`).
3. Open the **Apple Home** app on your iPhone or iPad.
4. Tap **+** > **Add Accessory**, then scan the QR code displayed on screen or select **More options...** and enter the setup code manually.
5. Assign each light to its room and complete setup.

### Requirements & Network Notes
- **Firewall**: When prompted by Windows Defender Firewall, allow Lumos network access on Private networks.
- **Subnet**: Your PC and iOS device must be connected to the same local Wi-Fi subnet for mDNS discovery.
- **Remote Access**: Controlling accessories outside your home network or executing time-based HomeKit automations requires an Apple Home Hub (Apple TV or HomePod) on your network.

---

## Local Webhook Integration

Lumos provides an embedded HTTP webhook server listening on `127.0.0.1:8989` for local automations, notifications, and visual flash alerts.

### Authentication
Requests require a Bearer token in the `Authorization` header. You can view or copy your unique token in **Settings** > **Local Webhook**.

### Endpoints

#### POST `/webhook`
Trigger light flashes or state modifications.

**Request Headers:**
```http
Content-Type: application/json
Authorization: Bearer YOUR_WEBHOOK_TOKEN
```

**Request Payload:**
```json
{
  "flash": true,
  "color": "#ff0000",
  "count": 3,
  "duration": 200,
  "targets": ["bf0123456789abcdef0123"]
}
```

- `flash` (boolean): Whether to execute a flash alert sequence.
- `color` (string, optional): Hex color code for the flash (e.g., `"#3b82f6"` for blue).
- `count` (number, optional): Number of flash pulses (default: `2`).
- `duration` (number, optional): Flash pulse duration in milliseconds (default: `150`).
- `targets` (string[], optional): Array of device IDs to target. Omit to flash all online lights.

#### Example: Trigger Alert via cURL
```bash
curl -X POST http://127.0.0.1:8989/webhook \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_WEBHOOK_TOKEN" \
  -d '{"flash": true, "color": "#00ff88", "count": 2}'
```

#### Example: Trigger Alert via PowerShell
```powershell
$headers = @{
    "Content-Type"  = "application/json"
    "Authorization" = "Bearer YOUR_WEBHOOK_TOKEN"
}
$body = @{
    flash = $true
    color = "#f59e0b"
    count = 2
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://127.0.0.1:8989/webhook" -Method Post -Headers $headers -Body $body
```

---

## Troubleshooting

### Device Shows Offline
- Verify that the light fixture is powered on at the physical wall switch.
- Ensure the IP address in your configuration matches the bulb's current DHCP assignment. If the IP changed, Lumos will automatically attempt ARP MAC resolution, or you can run `python -m tinytuya scan` to refresh IP addresses.

### Protocol Version Mismatch
- Tuya devices communicate on protocol version 3.1, 3.3, 3.4, or 3.5. Ensure the `version` field in `devices.json` matches your device (usually `"3.3"` for standard Wi-Fi bulbs).

### Key Error or Decryption Failure After Re-pairing
- If a bulb is re-paired or reset in the Smart Life app, Tuya generates a new local key. You must re-run `python -m tinytuya wizard` to obtain the updated `key`.

### Multiple Local Connections Conflict
- Tuya Wi-Fi bulbs only accept **one** active local TCP connection at a time. If the Smart Life app is open on your mobile device or another local controller is active, close it to allow Lumos to connect.

### Bulbs Not Showing Color Controls
- Only bulbs that report `colour_data_v2` or `colour_data` in their DPS mapping provide RGB color controls. White/CCT-only bulbs will show brightness and temperature sliders only.

### HomeKit Accessory Not Discovered
- Check that Windows Defender Firewall is not blocking port 51826 or mDNS UDP port 5353.
- Verify that your PC and iOS device are connected to the same subnet/VLAN without client isolation enabled.

---

## Build from Source

### Prerequisites
- Node.js 18.0.0 or higher (Node 22 LTS recommended)
- npm 9.0.0 or higher

### Build Commands

```bash
# Clone the repository
git clone https://github.com/TalibIbrahim/Lumos.git
cd Lumos

# Install dependencies
npm install

# Run type checks
npm run typecheck

# Run unit and integration tests
npm test

# Launch development build with hot reload
npm run dev

# Build Windows NSIS installer
npm run build:win
```

Installer output will be located in the `dist/` directory as `Lumos-Setup-1.0.0.exe`.

---

## Privacy and Security

- **Local Execution**: Lumos communicates directly with your lighting hardware over your local area network (LAN). No lighting telemetry or device commands are sent to external servers.
- **Secure Key Storage**: Device keys and HomeKit credentials remain strictly on your local machine in your OS user application data directory (`%APPDATA%/Lumos`).
- **Local Webhook**: The embedded webhook server binds strictly to the loopback interface (`127.0.0.1`) and requires Bearer token authentication for all requests.

---

## Limitations

- Supports Tuya-based Wi-Fi bulbs and light strips that implement Tuya LAN protocol 3.1, 3.3, 3.4, or 3.5.
- Does not support Bluetooth-only or Zigbee bulbs without an active Tuya LAN gateway.
- Simultaneous local connections are limited by bulb firmware (one local controller at a time per bulb).

---

## Contributing

Contributions are welcome. Please ensure that:
1. All changes pass TypeScript validation (`npm run typecheck`) and tests (`npm test`).
2. Design standards and UI consistency are maintained.
3. Code contains no proprietary secrets or personal identifiers.

---

## Acknowledgements

Lumos is built with the help of the following open-source projects:
- [React Bits](https://reactbits.dev/) - Glass surface and visual component primitives
- [hap-nodejs](https://github.com/homebridge/HAP-NodeJS) - Apple HomeKit Accessory Protocol implementation
- [TuyAPI](https://github.com/codetheweb/tuyapi) - Node.js library for Tuya LAN protocol communication
- [TinyTuya](https://github.com/jasonacox/tinytuya) - Python module for Tuya device key extraction and discovery
- [Lucide Icons](https://lucide.dev/) - Clean, consistent iconography

### Disclaimer
Lumos is an independent open-source project. It is not affiliated with, authorized, maintained, sponsored, or endorsed by Tuya, Apple Inc., or React Bits. All product names, logos, and brands are property of their respective owners.

---

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
