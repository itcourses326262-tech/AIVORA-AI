// Vitest aliases the `server-only` package to this module. The real package throws when it is
// imported outside a React Server Components build, which would make server code untestable.
export {};
