import React, {useState} from 'react';
import {Pressable, SafeAreaView, StyleSheet, Text, View} from 'react-native';

import {BenchmarkScreen} from './src/screens/BenchmarkScreen';
import {DashboardBenchmarkScreen} from './src/screens/DashboardBenchmarkScreen';

type ScreenKey = 'crdt' | 'dashboard';

function App(): React.JSX.Element {
  const [screen, setScreen] = useState<ScreenKey>('crdt');

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.switcher}>
        <Pressable
          onPress={() => setScreen('crdt')}
          style={({pressed}) => [
            styles.tab,
            screen === 'crdt' && styles.tabSelected,
            pressed && styles.tabPressed,
          ]}>
          <Text
            style={[
              styles.tabText,
              screen === 'crdt' && styles.tabTextSelected,
            ]}>
            CRDT Benchmark
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setScreen('dashboard')}
          style={({pressed}) => [
            styles.tab,
            screen === 'dashboard' && styles.tabSelected,
            pressed && styles.tabPressed,
          ]}>
          <Text
            style={[
              styles.tabText,
              screen === 'dashboard' && styles.tabTextSelected,
            ]}>
            Dashboard Workload
          </Text>
        </Pressable>
      </View>

      <View style={styles.content}>
        {screen === 'crdt' ? <BenchmarkScreen /> : <DashboardBenchmarkScreen />}
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
    fontSize: 12,
    fontWeight: '700',
    color: '#111',
  },
  tabTextSelected: {color: '#fff'},
  content: {flex: 1},
});
