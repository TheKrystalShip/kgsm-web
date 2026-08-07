import { Icon } from "../../components/Icon.jsx";
import { ServerTile } from "../../components/ServerCard.jsx";

// GameServersTab — every server in the cluster running from this blueprint. Same
// ServerTile cards as the dashboard and the Servers page, so an instance looks
// identical wherever you meet it; `showHost` is always on because this list is
// cluster-wide by definition.

function GameServersTab({ game, instances, canCreate, onCreate, onOpenServer, onAction, createBtn }) {
  const shortName = game.name.split(":")[0].trim();

  return (
    <div className="chat-brief">
      <div className="chat-brief__head">
        <span className="chat-brief__title">
          <Icon name="server" size={13} /> Your servers
          {instances.length > 0 && <span className="chat-brief__count chat-brief__count--neutral">{instances.length}</span>}
        </span>
        {canCreate && instances.length > 0 && (
          <button className="dash-section__more" onClick={() => onCreate(game)}>
            Create another <Icon name="plus" size={11} strokeWidth={2.4} />
          </button>
        )}
      </div>
      <div className="chat-brief__body">
        {instances.length === 0 ? (
          <div className="game-empty">
            <Icon name="server-off" size={22} />
            <div className="game-empty__title">No {shortName} servers yet</div>
            <div className="game-empty__sub">Spin one up and Krystal handles the build download, ports and a starter config.</div>
            <div style={{ marginTop: 6 }}>{createBtn}</div>
          </div>
        ) : (
          <div className="server-grid">
            {instances.map(s => (
              <ServerTile key={s.id} server={s} onOpen={onOpenServer} onAction={onAction} showHost />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export { GameServersTab };
export default GameServersTab;
