import { MenuBarExtra, open, getPreferenceValues } from "@raycast/api";
import { useState, useEffect, useCallback } from "react";
import fetch from "node-fetch";

const NHL_LOGO = "https://assets.nhle.com/logos/nhl/svg/NHL_dark.svg";

interface Preferences {
  displayMode: "score" | "logo";
  favoriteTeam: string;
}

interface Game {
  id: number;
  startTimeUTC: string;
  awayTeam: { abbrev: string; score?: number; logo?: string };
  homeTeam: { abbrev: string; score?: number; logo?: string };
  gameState: string;
  period?: number;
  periodDescriptor?: {
    number: number;
    periodType: string;
  };
  gameStateDescriptor?: {
    periodTime: string;
  };
}

interface ScheduleResponse {
  gameWeek: {
    date: string;
    games: Game[];
  }[];
}

interface WeekData {
  date: string;
  games: Game[];
}

export default function Command() {
  const [games, setGames] = useState<Game[]>([]);
  const [currentGameIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const preferences = getPreferenceValues<Preferences>();

  const isLive = (game: Game) => game.gameState === "LIVE" || game.gameState === "CRIT";
  const isFinal = (game: Game) => game.gameState === "FINAL" || game.gameState === "OFF";
  const isUpcoming = (game: Game) => !isLive(game) && !isFinal(game);

  const getTeamLogo = (teamAbbrev: string): string => {
    // Special case for Ottawa Senators
    if (teamAbbrev === "OTT") {
      return "https://assets.nhle.com/logos/nhl/svg/OTT_dark.svg";
    }
    // For all other teams, continue using light variant
    return `https://assets.nhle.com/logos/nhl/svg/${teamAbbrev}_light.svg`;
  };

  const fetchGames = useCallback(async () => {
    try {
      const response = await fetch("https://api-web.nhle.com/v1/schedule/now");
      const data = await response.json();

      if (isValidScheduleResponse(data)) {
        const today = new Date();
        const todayString =
          today.getFullYear() +
          "-" +
          String(today.getMonth() + 1).padStart(2, "0") +
          "-" +
          String(today.getDate()).padStart(2, "0");

        let todayGames: Game[] = [];

        const exactMatch = data.gameWeek.find((week) => week.date === todayString);
        if (exactMatch) {
          todayGames = exactMatch.games.map((game) => ({
            ...game,
            awayTeam: {
              ...game.awayTeam,
              logo: getTeamLogo(game.awayTeam.abbrev),
            },
            homeTeam: {
              ...game.homeTeam,
              logo: getTeamLogo(game.homeTeam.abbrev),
            },
          }));
        } else {
          todayGames = data.gameWeek
            .flatMap((week) => week.games)
            .filter((game) => {
              const gameDate = new Date(game.startTimeUTC);
              return gameDate.toDateString() === today.toDateString();
            })
            .map((game) => ({
              ...game,
              awayTeam: {
                ...game.awayTeam,
                logo: getTeamLogo(game.awayTeam.abbrev),
              },
              homeTeam: {
                ...game.homeTeam,
                logo: getTeamLogo(game.homeTeam.abbrev),
              },
            }));
        }

        setGames(todayGames);
        setLastUpdated(new Date());
      }
    } catch (error) {
      console.error("Error fetching games:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  function isValidScheduleResponse(data: unknown): data is ScheduleResponse {
    const scheduleData = data as { gameWeek?: WeekData[] };
    return (
      !!scheduleData &&
      Array.isArray(scheduleData.gameWeek) &&
      scheduleData.gameWeek.every(
        (week: WeekData) =>
          typeof week.date === "string" &&
          Array.isArray(week.games) &&
          week.games.every(
            (game: Game) =>
              typeof game.id === "number" &&
              typeof game.startTimeUTC === "string" &&
              typeof game.gameState === "string" &&
              typeof game.awayTeam?.abbrev === "string" &&
              typeof game.homeTeam?.abbrev === "string",
          ),
      )
    );
  }
  useEffect(() => {
    fetchGames();

    const liveUpdateInterval = setInterval(() => {
      const hasLiveGames = games.some((game) => isLive(game));
      if (hasLiveGames) {
        fetchGames();
      }
    }, 30000);

    const generalUpdateInterval = setInterval(fetchGames, 300000);

    return () => {
      clearInterval(liveUpdateInterval);
      clearInterval(generalUpdateInterval);
    };
  }, [fetchGames, games]);

  function getGameStatus(game: Game): string {
    if (isLive(game)) {
      const periodNumber = game.periodDescriptor?.number || game.period;
      switch (periodNumber) {
        case 1:
          return "(1st)";
        case 2:
          return "(2nd)";
        case 3:
          return "(3rd)";
        default:
          return `(${periodNumber}th)`;
      }
    } else if (isFinal(game)) {
      return "(Final)";
    } else {
      const gameTime = new Date(game.startTimeUTC);
      return `(${gameTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})`;
    }
  }

  function formatGameScore(game: Game): { title: string; icon?: { source: string } } {
    const favoriteTeam = preferences.favoriteTeam.toUpperCase();

    if (preferences.displayMode === "logo") {
      if (favoriteTeam && (game.awayTeam.abbrev === favoriteTeam || game.homeTeam.abbrev === favoriteTeam)) {
        const teamLogo = game.awayTeam.abbrev === favoriteTeam ? game.awayTeam.logo : game.homeTeam.logo;
        return {
          title: " ",
          icon: {
            source: teamLogo!,
          },
        };
      } else {
        return {
          title: " ",
          icon: {
            source: NHL_LOGO,
          },
        };
      }
    }

    const score = isUpcoming(game)
      ? `${game.awayTeam.abbrev} vs ${game.homeTeam.abbrev}`
      : `${game.awayTeam.abbrev} ${game.awayTeam.score ?? 0} | ${game.homeTeam.abbrev} ${game.homeTeam.score ?? 0}`;

    return {
      title: `${score} ${getGameStatus(game)}`,
    };
  }

  function GameItem({ game }: { game: Game }) {
    const awayScore = game.awayTeam.score ?? 0;
    const homeScore = game.homeTeam.score ?? 0;
    const awayTeamWinning = awayScore > homeScore;
    const gameIsUpcoming = isUpcoming(game);

    const topTeam = awayTeamWinning ? game.homeTeam : game.awayTeam;
    const bottomTeam = awayTeamWinning ? game.awayTeam : game.homeTeam;

    return (
      <MenuBarExtra.Section>
        <MenuBarExtra.Item
          key={`${game.id}-top`}
          title={`${topTeam.abbrev} ${gameIsUpcoming ? "" : topTeam.score}`}
          icon={{
            source: topTeam.logo!,
          }}
        />

        <MenuBarExtra.Item
          key={`${game.id}-bottom`}
          title={`${bottomTeam.abbrev} ${gameIsUpcoming ? "" : bottomTeam.score}`}
          icon={{
            source: bottomTeam.logo!,
          }}
        />

        <MenuBarExtra.Item
          key={`${game.id}-time`}
          title={getGameStatus(game)}
          onAction={() => open(`https://www.nhl.com/gamecenter/${game.id}`)}
        />
      </MenuBarExtra.Section>
    );
  }

  const currentGame = games[currentGameIndex];
  const liveGames = games.filter(isLive);
  const upcomingGames = games.filter(isUpcoming);
  const finalGames = games.filter(isFinal);

  const menuBarContent = currentGame ? formatGameScore(currentGame) : { title: "No Games Today" };

  return (
    <MenuBarExtra
      isLoading={isLoading}
      {...menuBarContent}
      tooltip={currentGame ? `${currentGame.awayTeam.abbrev} vs ${currentGame.homeTeam.abbrev}` : undefined}
    >
      {games.length > 0 ? (
        <>
          {liveGames.length > 0 && (
            <MenuBarExtra.Section title="🟢 Live Games">
              {liveGames.map((game) => (
                <GameItem key={game.id} game={game} />
              ))}
            </MenuBarExtra.Section>
          )}

          {upcomingGames.length > 0 && (
            <MenuBarExtra.Section title="🟡 Upcoming Games">
              {upcomingGames.map((game) => (
                <GameItem key={game.id} game={game} />
              ))}
            </MenuBarExtra.Section>
          )}

          {finalGames.length > 0 && (
            <MenuBarExtra.Section title="🔴 Final Games">
              {finalGames.map((game) => (
                <GameItem key={game.id} game={game} />
              ))}
            </MenuBarExtra.Section>
          )}

          <MenuBarExtra.Section>
            <MenuBarExtra.Item title={`Last updated: ${lastUpdated.toLocaleTimeString()}`} />
          </MenuBarExtra.Section>
        </>
      ) : (
        <MenuBarExtra.Section>
          <MenuBarExtra.Item title={isLoading ? "Loading games..." : "No games scheduled for today"} />
        </MenuBarExtra.Section>
      )}
    </MenuBarExtra>
  );
}
