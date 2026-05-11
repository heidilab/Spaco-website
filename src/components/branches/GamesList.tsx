// Renders per-branch Switch + board game lists. Admin enters one game
// per line in /admin/content; we split into pill chips here. Pure
// presentational — no data fetching.

import { Gamepad2, Dice5 } from 'lucide-react';

interface GamesListProps {
  switchGames: string[];
  boardGames: string[];
  locale: 'zh' | 'en';
}

export default function GamesList({ switchGames, boardGames, locale }: GamesListProps) {
  // Don't render anything if both lists are empty.
  if (switchGames.length === 0 && boardGames.length === 0) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      {switchGames.length > 0 && (
        <GameSection
          icon={<Gamepad2 size={20} />}
          title={locale === 'zh' ? 'Switch 遊戲' : 'Switch Games'}
          subtitle={locale === 'zh' ? `${switchGames.length} 款可玩` : `${switchGames.length} titles available`}
          games={switchGames}
          variant="switch"
        />
      )}
      {boardGames.length > 0 && (
        <GameSection
          icon={<Dice5 size={20} />}
          title={locale === 'zh' ? '桌遊' : 'Board Games'}
          subtitle={locale === 'zh' ? `${boardGames.length} 款可玩` : `${boardGames.length} titles available`}
          games={boardGames}
          variant="board"
        />
      )}
    </div>
  );
}

function GameSection({
  icon, title, subtitle, games, variant,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  games: string[];
  variant: 'switch' | 'board';
}) {
  const iconGradient = variant === 'switch'
    ? 'from-rose-500 to-orange-500'
    : 'from-violet-500 to-pink-500';
  const chipClass = variant === 'switch'
    ? 'bg-rose-50 text-rose-700 border-rose-200'
    : 'bg-violet-50 text-violet-700 border-violet-200';

  return (
    <div className="glass-card p-7 md:p-8">
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${iconGradient} flex items-center justify-center text-white shadow-glow`}>
          {icon}
        </div>
        <div>
          <h3 className="font-bold font-display text-lg">{title}</h3>
          <p className="text-xs text-ink-soft">{subtitle}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {games.map((g, i) => (
          <span
            key={i}
            className={`inline-flex items-center px-3 py-1.5 rounded-pill text-sm border ${chipClass}`}
          >
            {g}
          </span>
        ))}
      </div>
    </div>
  );
}
