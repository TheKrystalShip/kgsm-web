namespace TheKrystalShip.KGSM.Web.Services;

using TheKrystalShip.KGSM.Lib;

public class KgsmEventListener
{
    private readonly KgsmInterop _interop;
    private readonly KgsmEventState _eventState;
    private readonly ILogger<KgsmEventListener> _logger;

    public KgsmEventListener(KgsmInterop interop, KgsmEventState eventState, ILogger<KgsmEventListener> logger)
    {
        _interop = interop;
        _eventState = eventState;
        _logger = logger;
    }

    public void Initialize()
    {
        _interop.Events.RegisterHandler<InstanceStartedData>(OnInstanceStartedAsync);
        _interop.Events.RegisterHandler<InstanceStoppedData>(OnInstanceStoppedAsync);
        _interop.Events.RegisterHandler<InstanceInstalledData>(OnInstanceInstalledAsync);
        _interop.Events.RegisterHandler<InstanceUninstalledData>(OnInstanceUninstalledAsync);

        _logger.LogInformation($"Registered event handlers");
    }

    public async Task OnInstanceInstalledAsync(InstanceInstalledData data)
    {
        string @event = $"Received installation data: Blueprint {data.Blueprint}, Instance ID {data.InstanceId}";
        _logger.LogInformation(@event);
        _eventState.AddEvent(@event);
        await Task.CompletedTask;
    }

    private async Task OnInstanceStartedAsync(InstanceStartedData data)
    {
        string @event = $"Received started data: {data.InstanceId}";
        _logger.LogInformation(@event);
        _eventState.AddEvent(@event);
        _eventState.OnInstanceStarted(data.InstanceId);
        await Task.CompletedTask;
    }

    private async Task OnInstanceStoppedAsync(InstanceStoppedData data)
    {
        string @event = $"Received stopped data: {data.InstanceId}";
        _logger.LogInformation(@event);
        _eventState.AddEvent(@event);
        _eventState.OnInstanceStopped(data.InstanceId);
        await Task.CompletedTask;
    }

    private async Task OnInstanceUninstalledAsync(InstanceUninstalledData data)
    {
        string @event = $"Received uninstalled data: {data.InstanceId}";
        _logger.LogInformation(@event);
        _eventState.AddEvent(@event);
        _eventState.OnInstanceUninstalled(data.InstanceId);
        await Task.CompletedTask;
    }
}