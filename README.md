# Arabesque

A web-based piano training application that helps musicians practice by connecting MIDI devices, displaying sheet music, and providing real-time feedback on note accuracy.

## Features

### Core Functionality
- **Score Library**: Browse and search 70 public domain classical music scores
- **MIDI Connection**: Connect MIDI devices via Web MIDI API (USB or Bluetooth)
- **Real-time Note Display**: Visual feedback showing played notes on a musical staff
- **MusicXML Support**: Load and display sheet music in MusicXML format
- **Interactive Practice**: Highlights notes as you play and validates accuracy
- **Recording & Playback**: Record MIDI performances and replay them

### Key Components

#### 1. Backend (Ruby/Sinatra)
- **API Endpoints**: RESTful API for managing MIDI recordings (cassettes)
- **File Management**: Stores recordings as JSON files

#### 2. Frontend (JavaScript/HTML/CSS)
- **MIDI Processing**: Parses MIDI messages from Bluetooth devices
- **MusicXML Rendering**: Uses OpenSheetMusicDisplay for sheet music visualization
- **Note Validation**: Compares played notes against sheet music
- **Visual Feedback**: Color-codes notes to show progress and errors

#### 3. Music Theory
- **Note Conversion**: Converts MIDI note numbers to musical notation
- **Score Extraction**: Parses MusicXML files to extract playable notes
- **Timing Analysis**: Tracks note timing and duration

## Technical Stack

### Backend
- **Framework**: Sinatra (Ruby web framework)
- **Dependencies**:
  - `sinatra`: Web framework
  - `json`: JSON processing
  - `fileutils`: File system operations
  - `puma`: Web server
  - `rack`: Web server interface

### Frontend
- **Libraries**:
  - `OpenSheetMusicDisplay`: MusicXML visualization
  - `Alpine.js`: Reactive UI framework
  - `Pico CSS`: Lightweight CSS framework

### Testing
- **Framework**: Minitest with Capybara
- **Driver**: Cuprite (headless Chrome)
- **Test Coverage**: MusicXML parsing, note extraction, playback

## Architecture

### Data Flow

```
MIDI Device → Web MIDI API → MIDI Message Parser → Note Validator → Visual Feedback
                          ↓
                     MusicXML Loader → Score Renderer → Note Extractor
                          ↓
                     Recording System → API → File Storage
```

### Key Files

- `app.rb`: Main Sinatra application with API endpoints
- `public/index.html`: Score library page with search and filtering
- `public/score.html`: Score practice page
- `public/data/scores.json`: Index of 70 available scores
- `public/scores/`: Directory with 70 MusicXML files (1.6MB)
- `public/js/app.js`: Alpine.js coordination layer
- `public/js/library.js`: Library page state and filtering
- `public/js/midi.js`: Web MIDI API & recording
- `public/js/musicxml.js`: MusicXML parsing & validation
- `public/js/cassettes.js`: Cassette management
- `public/js/midi_mock.js`: Mock implementation for testing
- `public/js/utils.js`: Utility functions
- `public/styles.css`: Custom styling
- `test/arabesque_test.rb`: core app tests
- `test/library_test.rb`: Library page tests
- `Rakefile`: Test runner configuration

## Setup & Installation

### Prerequisites
- Ruby 3.0+
- Chrome/Edge browser (for Web Bluetooth API support)

### Installation

```bash
# Clone the repository
git clone git@github.com:isc/arabesque.git
cd arabesque

# Install Ruby dependencies
bundle install

# Start the server
ruby app.rb
```

The application will be available at `http://localhost:4567`

## Usage

### Basic Workflow

1. **Browse Score Library** (Home page: `/`):
   - View all 70 available public domain scores
   - Search by title or composer
   - Click a score to load it for practice

2. **Connect MIDI Device**:
   - Click "Connecter clavier MIDI"
   - Select your MIDI device from the list (if multiple devices are connected)
   - Grant MIDI permissions if prompted

3. **Load Sheet Music**:
   - From the library: Click any score to automatically load it
   - Or manually upload: Click "Charger partition MusicXML" to select a file from your computer
   - The sheet music will be displayed

4. **Practice Mode**:
   - Play notes on your MIDI keyboard
   - The system highlights correct notes in green
   - Incorrect notes show error messages
   - Progress is tracked in real-time

5. **Recording**:
   - Click "Démarrer enregistrement" to start recording
   - Play your performance
   - Click "Arrêter enregistrement" to stop
   - Enter a name for your recording

6. **Playback**:
   - Select a recording from the dropdown
   - Click "Rejouer cassette" to play it back

### Score Library

The application includes 70 public domain classical music scores ready to practice:

- **Composers**: Bach, Beethoven, Chopin, Debussy, Mozart, Schumann, and more
- **Styles**: Sonatas, nocturnes, waltzes, preludes, minuets, variations
- **Search**: Filter by title or composer name
- **Direct Loading**: Click any score to instantly load and practice it
- **Local Storage**: All scores served from local `public/scores/` directory (1.6MB)

Available scores include popular pieces like:
- Moonlight Sonata (3 versions)
- Fur Elise (multiple arrangements)
- Canon in D
- Clair de Lune
- And 65 more classical masterpieces

### Advanced Features

- **Modular Architecture**: Clean separation of concerns with 6 specialized JavaScript modules
- **Note Validation**: The system checks if you're playing the correct notes from the sheet music
- **Progress Tracking**: Shows which notes you've played correctly and what's next
- **Error Feedback**: Displays what note was expected vs. what you played
- **Completion Detection**: Shows a celebration message when you complete a piece
- **Callback System**: Loose coupling between modules via event callbacks
- **URL Loading**: Load scores programmatically with `score.html?url=<score_url>`

## API Documentation

### GET /api/cassettes

Lists all available MIDI recordings (cassettes).

**Response**:
```json
[
  {
    "name": "recording_name",
    "file": "cassettes/recording_name.json",
    "created_at": "2025-08-13T16:50:11+02:00"
  }
]
```

### POST /api/cassettes

Saves a new MIDI recording.

**Request Body**:
```json
{
  "name": "my_recording",
  "data": [
    {
      "timestamp": 100,
      "data": [144, 60, 100]  // MIDI message
    }
  ]
}
```

**Response**:
```json
{
  "success": true,
  "message": "Cassette sauvegardée avec succès",
  "file": "cassettes/my_recording.json"
}
```

## MusicXML Processing

The application extracts musical information from MusicXML files:

1. **Score Discovery**: Indexes scores in `public/data/scores.json` for library browsing
2. **Note Extraction**: Parses pitch, duration, and timing information
3. **Measure Analysis**: Organizes notes by measure
4. **Validation**: Converts to MIDI note numbers for comparison
5. **Visualization**: Renders sheet music with OpenSheetMusicDisplay

### Score Index Format

`public/data/scores.json` contains metadata for all available scores:

```json
{
  "baseUrl": "/scores/",
  "scores": [
    {
      "title": "Score Title",
      "composer": "Composer Name",
      "file": "score-filename.mxl"
    }
  ]
}
```

### Supported MusicXML Elements

- `<note>`: Individual musical notes
- `<pitch>`: Note pitch (step + octave)
- `<duration>`: Note duration
- `<measure>`: Musical measures
- `<part>`: Instrument parts

## MIDI Processing

### MIDI Message Format

The application handles standard MIDI messages:

- **Note On**: `144` (0x90) - Note pressed
- **Note Off**: `128` (0x80) - Note released
- **Note Number**: 0-127 (MIDI note range)
- **Velocity**: 0-127 (how hard the note is played)

### MIDI Message Format

Standard MIDI format (3 bytes):
- Status byte (Note On: 144/0x90, Note Off: 128/0x80)
- Note number (0-127)
- Velocity (0-127)

## Development

### Running Tests

```bash
# Run all tests (16 tests, 75 assertions)
bundle exec rake test

# Or run individual test files
bundle exec ruby test/arabesque_test.rb
bundle exec ruby test/library_test.rb

# Run with UI (non-headless)
DISABLE_HEADLESS=1 bundle exec rake test
```

### Test Files

- `test/arabesque_test.rb`: 10 tests for core piano training features
- `test/library_test.rb`: 6 tests for score library functionality
- `test/fixtures/simple-score.xml`: Basic 4-note test score
- `test/fixtures/schumann-melodie.xml`: Complex multi-part score (256 notes)
- `public/cassettes/*.json`: Various cassette files for playback testing

### Debugging

- Browser console logs show MIDI message parsing
- Test logs capture browser output
- Error messages display in the UI for user feedback

## iOS App (Native Wrapper)

Safari/iOS does not support the Web MIDI API, so the `ios/` directory contains
a minimal native wrapper for iPad/iPhone: a WKWebView loads the deployed web
app unchanged, MIDI is collected natively with CoreMIDI (USB or Bluetooth),
and an injected shim emulates `navigator.requestMIDIAccess`. See
[ios/README.md](ios/README.md) for build instructions.

## Browser Compatibility

### Required Features

- **Web MIDI API**: Chrome 43+, Edge 79+, Opera 30+
- **ES6 Modules**: Modern browsers
- **Fetch API**: Modern browsers

### Recommended Browsers

- Chrome 90+
- Edge 90+
- Opera 76+

## Troubleshooting

### No MIDI Device Found

If no MIDI device appears when clicking "Connecter clavier MIDI":

1. Ensure your MIDI keyboard is connected (USB) or paired (Bluetooth) with your computer
2. Check that your browser supports Web MIDI API (Chrome, Edge, Opera)
3. Grant MIDI permissions when prompted by the browser

### Roland FP-30X Bluetooth MIDI Connection

If you're using a Roland FP-30X (or FP-30) keyboard via Bluetooth and it doesn't appear:

1. First, pair the keyboard with your operating system's Bluetooth settings
2. On your keyboard, press and hold the **Bluetooth** button together with the **first black key** (F#/Gb), then release both
3. Press **Bluetooth** again together with the **first white key** (F), then release both
4. Re-pair the keyboard in your OS settings, then refresh the web page

This procedure resets the Bluetooth connection state on the keyboard.

## Contributing

### Guidelines

1. **Code Style**: Follow existing patterns and conventions
2. **Testing**: Add tests for new features
3. **Documentation**: Update docs for changes
4. **Compatibility**: Ensure cross-browser support

### Areas for Improvement

- **Mobile Support**: Better mobile UI
- **Additional Instruments**: Support for bass clef, percussion
- **Advanced Features**: Tempo detection, metronome
- **Export Options**: Export recordings to standard formats

## License

[MIT License](https://opensource.org/licenses/MIT)

## Credits

- **OpenSheetMusicDisplay**: MusicXML visualization
- **Alpine.js**: Reactive UI framework
- **Pico CSS**: Lightweight styling

## Support

For issues, questions, or contributions, please open an issue or pull request on the GitHub repository.
