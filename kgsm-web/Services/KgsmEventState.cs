
namespace TheKrystalShip.KGSM.Web.Services;

public class KgsmEventState
{
    public event Action OnChange;
    public IReadOnlyList<string> Events => _events;

    private List<string> _events = [];

    public void AddEvent(string newEvent)
    {
        _events.Add(newEvent);
        NotifyStateChanged();
    }

    private void NotifyStateChanged() => OnChange?.Invoke();
}