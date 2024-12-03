using TheKrystalShip.KGSM.Lib;

using System.Text.Json;

namespace TheKrystalShip.KGSM.Web.Services;

public class KgsmEventState
{
    private KgsmInterop _interop;
    private List<string> _events;
    private Dictionary<string, Blueprint> _blueprints;
    private Dictionary<string, Instance> _instances;

    public IReadOnlyList<string> Events => _events;
    public IReadOnlyDictionary<string, Blueprint> Blueprints => _blueprints;
    public IReadOnlyDictionary<string, Instance> Instances => _instances;

    public event Action? OnChange;

    public KgsmEventState(KgsmInterop interop)
    {
        _interop = interop;

        _events = new();
        _blueprints = new();
        _instances = new();
    }

    public void Initialize()
    {
        this.LoadBlueprints();
        this.LoadInstances();
    }

    public void LoadBlueprints()
    {
        _blueprints = new Dictionary<string, Blueprint>(_interop.GetBlueprints());
        NotifyStateChanged();
    }

    public void LoadInstances()
    {
        _instances = new Dictionary<string, Instance>(_interop.GetInstances());
        NotifyStateChanged();
    }

    public void AddEvent(string newEvent)
    {
        _events = new List<string>(_events) { newEvent };
        NotifyStateChanged();
    }

    public void OnInstanceStarted(string instanceId)
    {
        this.ReloadInstance(instanceId);
    }

    public void OnInstanceStopped(string instanceId)
    {
        this.ReloadInstance(instanceId);
    }

    public void ReloadInstance(string instanceId)
    {
        if (_instances.ContainsKey(instanceId))
        {
            KgsmResult result = _interop.AdHoc("-i", instanceId, "--info", "--json");
            Instance newInstance = JsonSerializer.Deserialize<Instance>(result.Stdout) ??
                throw new InvalidOperationException("Failed to deserialize to Instance type");

            _instances = new Dictionary<string, Instance>(_instances)
            {
                [instanceId] = newInstance
            };
            NotifyStateChanged();
        }
        else 
        {
            Console.WriteLine($"State does not contain a key for {instanceId}");
        }
    }

    public void OnInstanceUninstalled(string instanceId)
    {
        if (_instances.ContainsKey(instanceId))
        {
            _instances.Remove(instanceId);
            _instances = new Dictionary<string, Instance>(_instances);
            NotifyStateChanged();
        }
    }

    private void NotifyStateChanged() => OnChange?.Invoke();
}