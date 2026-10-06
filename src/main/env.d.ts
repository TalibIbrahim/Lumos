/** electron-vite: importing a module with ?modulePath yields the path of its bundled file (used for worker threads). */
declare module '*?modulePath' {
  const path: string
  export default path
}
