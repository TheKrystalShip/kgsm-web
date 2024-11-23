namespace TheKrystalShip.KGSM.Web.Services;

using System;

using TheKrystalShip.KGSM.Lib;

public class KgsmEventListener
{
    private readonly KgsmInterop _interop;
    private readonly ILogger<KgsmEventListener> _logger;

    public KgsmEventListener(KgsmInterop interop, ILogger<KgsmEventListener> logger)
    {
        _interop = interop;
        _logger = logger;
    }

    public void Initialize()
    {
        _interop.Events.RegisterHandler<InstanceStartedData>(OnInstanceStartedAsync);
        _interop.Events.RegisterHandler<InstanceInstalledData>(OnInstanceInstalledAsync);
    }

    public async Task OnInstanceInstalledAsync(InstanceInstalledData data)
    {
        _logger.LogInformation($"Received installation data: ({data.InstanceId}) {data.Blueprint}");
        await Task.CompletedTask;
    }

    private async Task OnInstanceStartedAsync(InstanceStartedData data)
    {
        _logger.LogInformation($"Received started data: {data.InstanceId}");
        await Task.CompletedTask;
    }
}