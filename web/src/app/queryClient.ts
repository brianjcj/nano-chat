import { QueryClient, type QueryClientConfig } from "@tanstack/react-query";

const defaultQueryClientConfig = {
  defaultOptions: {
    queries: {
      gcTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30 * 1000,
    },
    mutations: {
      retry: 0,
    },
  },
} satisfies QueryClientConfig;

export function createQueryClient(config: QueryClientConfig = {}) {
  return new QueryClient({
    ...defaultQueryClientConfig,
    ...config,
    defaultOptions: {
      ...defaultQueryClientConfig.defaultOptions,
      ...config.defaultOptions,
      queries: {
        ...defaultQueryClientConfig.defaultOptions?.queries,
        ...config.defaultOptions?.queries,
      },
      mutations: {
        ...defaultQueryClientConfig.defaultOptions?.mutations,
        ...config.defaultOptions?.mutations,
      },
    },
  });
}

export const queryClient = createQueryClient();
