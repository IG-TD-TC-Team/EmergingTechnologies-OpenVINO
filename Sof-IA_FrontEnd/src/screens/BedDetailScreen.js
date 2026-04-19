/**
 * BedDetailScreen
 *
 * Shows raw transcription segments for the selected bed/session.
 * Structured UX is handled in future US.
 */

import React from 'react';
import { FlatList, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

const arrowBackSvg = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M20 11H7.83L13.42 5.41L12 4L4 12L12 20L13.41 18.59L7.83 13H20V11Z" fill="#1D1B20"/>
</svg>`;

function SegmentCard({ item }) {
  let structured = null;
  try {
    if (item.structured_json) structured = JSON.parse(item.structured_json);
  } catch (_) {}

  const ts = item.ts_start
    ? new Date(item.ts_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  return (
    <View style={styles.card}>
      {ts && <Text style={styles.timestamp}>{ts}</Text>}
      <Text style={styles.transcript}>{item.transcript || '(no speech detected)'}</Text>
      {structured && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Text style={styles.json}>{JSON.stringify(structured, null, 2)}</Text>
        </ScrollView>
      )}
    </View>
  );
}

function BedDetailScreen({ route, navigation }) {
  const { patient, segments = [] } = route.params;
  const sorted = [...segments].sort((a, b) => (b.ts_start ?? 0) - (a.ts_start ?? 0));

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Go back"
        >
          <SvgXml xml={arrowBackSvg} width={24} height={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          Bed {patient.bed}{patient.name ? `: "${patient.name}"` : ''}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {sorted.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No transcriptions yet for this session.</Text>
        </View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <SegmentCard item={item} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 64,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#CAC4D0',
  },
  backButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '500',
    color: '#1D1B20',
    textAlign: 'center',
  },
  headerSpacer: { width: 48 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#767676',
  },
  list: {
    padding: 16,
    gap: 12,
  },
  card: {
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  timestamp: {
    fontSize: 11,
    color: '#767676',
    marginBottom: 4,
  },
  transcript: {
    fontSize: 15,
    color: '#1D1B20',
    marginBottom: 8,
  },
  json: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#3A3A3A',
  },
});

export default BedDetailScreen;