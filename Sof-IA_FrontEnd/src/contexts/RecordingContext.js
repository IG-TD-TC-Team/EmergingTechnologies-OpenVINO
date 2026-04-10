/**
 * RecordingContext
 *
 * Global React context that shares recording state across all screens.
 * This allows RecordingIndicator to be mounted once in App.js and remain
 * visible on every screen without prop-drilling.
 *
 * Usage:
 *   const { isRecording, connectionStatus } = useRecordingContext();
 */

import React, { createContext, useContext, useState } from 'react';

const RecordingContext = createContext({
  isRecording: false,
  connectionStatus: 'online',
  setIsRecording: () => {},
  setConnectionStatus: () => {},
});

export function RecordingProvider({ children }) {
  const [isRecording, setIsRecording] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('online');

  return (
    <RecordingContext.Provider
      value={{ isRecording, connectionStatus, setIsRecording, setConnectionStatus }}
    >
      {children}
    </RecordingContext.Provider>
  );
}

export function useRecordingContext() {
  return useContext(RecordingContext);
}

export default RecordingContext;