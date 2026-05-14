import AsyncStorage from '@react-native-async-storage/async-storage';
import StorageKeys from '../constants/storageKeys';

const DEFAULT_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';

const ApiConfigService = {
    getDefault() {
        return DEFAULT_URL;
    },

    async getApiUrl() {
        try {
            const stored = await AsyncStorage.getItem(StorageKeys.API_URL);
            return stored ?? DEFAULT_URL;
        } catch {
            return DEFAULT_URL;
        }
    },

    async setApiUrl(url) {
        await AsyncStorage.setItem(StorageKeys.API_URL, url.trim());
    },

    async reset() {
        await AsyncStorage.removeItem(StorageKeys.API_URL);
    },
};

export default ApiConfigService;
