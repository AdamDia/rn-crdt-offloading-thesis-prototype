import React, {useState} from 'react';
import {Pressable, SafeAreaView, StyleSheet, Text, View} from 'react-native';

import {ArchitectureComparisonScreen} from './src/screens/ArchitectureComparisonScreen';
import {BenchmarkScreen} from './src/screens/BenchmarkScreen';
import {DashboardBenchmarkScreen} from './src/screens/DashboardBenchmarkScreen';

type ScreenKey = 'crdt' | 'dashboard' | 'architecture';

const SCREEN_TABS: Array<{key: ScreenKey; label: string}> = [
  {key: 'crdt', label: 'CRDT Benchmark'},
  {key: 'dashboard', label: 'Dashboard Benchmark'},
  {key: 'architecture', label: 'Architecture Comparison'},
];

function App(): React.JSX.Element {
  const [screen, setScreen] = useState<ScreenKey>('crdt');

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.switcher}>
        {SCREEN_TABS.map(tab => (
          <Pressable
            key={tab.key}
            onPress={() => setScreen(tab.key)}
            style={({pressed}) => [
              styles.tab,
              screen === tab.key && styles.tabSelected,
              pressed && styles.tabPressed,
            ]}>
            <Text
              style={[
                styles.tabText,
                screen === tab.key && styles.tabTextSelected,
              ]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.content}>
        {screen === 'crdt' ? (
          <BenchmarkScreen />
        ) : screen === 'dashboard' ? (
          <DashboardBenchmarkScreen />
        ) : (
          <ArchitectureComparisonScreen />
        )}
      </View>
    </SafeAreaView>
  );
}

export default App;

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: '#fff'},
  switcher: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.12)',
    backgroundColor: '#fff',
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.22)',
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  tabSelected: {
    backgroundColor: '#111',
    borderColor: '#111',
  },
  tabPressed: {opacity: 0.9},
  tabText: {
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
    color: '#111',
    lineHeight: 14,
  },
  tabTextSelected: {color: '#fff'},
  content: {flex: 1},
});
