import { MutationCache, QueryClient } from "@tanstack/react-query";
import { todoKeys } from "../api/todo";

/**
 * TanStack Query client configuration.
 *
 * Any change that succeeds refreshes the To do list in the top bar: fixing
 * something anywhere in the app makes its line leave, without every page
 * having to remember the To do query.
 */
export const queryClient: QueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
  mutationCache: new MutationCache({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: todoKeys.all }),
  }),
});
