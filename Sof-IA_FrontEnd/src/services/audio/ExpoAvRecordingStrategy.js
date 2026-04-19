/**
 * ExpoAvRecordingStrategy
 *
 * Android recording strategy using expo-av.
 * Records in M4A/AAC format at 16kHz mono — optimised for Whisper accuracy.
 *
 * Interface (shared with WebMediaRecordingStrategy):
 *   prepare(sessionId)  — request audio mode, create output directory
 *   startChunk()        — begin recording a new 30-second chunk
 *   stopChunk()         — stop current chunk → { uri, durationMs, fileSizeBytes }
 *   teardown()          — release audio session
 */

import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { v4 as uuidv4 } from 'uuid';

const RECORDING_OPTIONS = {
  android: {
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 128000,
  },
  ios: {
    extension: '.caf',
    audioQuality: Audio.IOSAudioQuality.MIN,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 128000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {},
};

const ExpoAvRecordingStrategy = {
  _recording: null,
  _sessionId: null,
  _recordingsDir: null,

  /**
   * Prepare audio session and output directory.
   * Called once when the nurse activates recording.
   */
  async prepare(sessionId) {
    this._sessionId = sessionId;
    this._recordingsDir = `${FileSystem.documentDirectory}recordings/`;

    await FileSystem.makeDirectoryAsync(this._recordingsDir, { intermediates: true });

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
    });

    console.log('[ExpoAv] Strategy prepared for session:', sessionId);
  },

  /**
   * Start recording a new chunk.
   * Called at the beginning of each 30-second window.
   */
  async startChunk() {
    if (this._recording) {
      console.warn('[ExpoAv] startChunk called while a recording is already active — stopping previous');
      await this.stopChunk();
    }

    const recording = new Audio.Recording();
    await recording.prepareToRecordAsync(RECORDING_OPTIONS);
    await recording.startAsync();
    this._recording = recording;

    console.log('[ExpoAv] Chunk started');
  },

  /**
   * Stop the current chunk and return its file info.
   * The gap between stopChunk() and the next startChunk() (150–400ms on Android)
   * is logged as an audit gap by ContinuousRecordingService.
   */
  async stopChunk() {
    if (!this._recording) {
      throw new Error('[ExpoAv] stopChunk called with no active recording');
    }

    const status = await this._recording.getStatusAsync();
    await this._recording.stopAndUnloadAsync();

    const uri = this._recording.getURI();
    const durationMs = status.durationMillis ?? 0;

    this._recording = null;

    let fileSizeBytes = 0;
    try {
      const info = await FileSystem.getInfoAsync(uri, { size: true });
      fileSizeBytes = info.size ?? 0;
    } catch (_) {
      // Non-critical — file size will be 0 as placeholder
    }

    console.log('[ExpoAv] Chunk stopped — uri:', uri, 'duration:', durationMs, 'ms');
    return { uri, durationMs, fileSizeBytes };
  },

  /**
   * Release the audio session.
   * Called when the nurse deactivates recording or shift ends.
   */
  async teardown() {
    if (this._recording) {
      try {
        await this._recording.stopAndUnloadAsync();
      } catch (_) {}
      this._recording = null;
    }

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
    });

    this._sessionId = null;
    console.log('[ExpoAv] Strategy torn down');
  },

  isActive() {
    return this._recording !== null;
  },
};

export default ExpoAvRecordingStrategy;