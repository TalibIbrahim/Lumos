import { Music2, Disc3, MoonStar, Gamepad2, MonitorPlay, Rainbow, Flame, LucideIcon } from 'lucide-react'

/** Icon for each effect, shared by the Effects page and the settings sheet. */
export const EFFECT_ICONS: Record<string, LucideIcon> = {
  screen: MonitorPlay,
  music: Music2,
  album: Disc3,
  cycle: Rainbow,
  fireplace: Flame,
  away: MoonStar,
  games: Gamepad2
}
