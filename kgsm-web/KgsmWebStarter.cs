using TheKrystalShip.KGSM.Web.Services;
using TheKrystalShip.KGSM.Web.Components;

namespace TheKrystalShip.KGSM.Web;

public class KgsmWebStarter
{
    public KgsmWebStarter()
    {

    }

    public void Initialize(string[] args)
    {
        WebApplicationBuilder builder = WebApplication.CreateBuilder(args);

        // Doesn't quite work, TODO
        builder.WebHost.UseKestrel().UseUrls("http://0.0.0.0:5183");

        string kgsmPath = builder.Configuration["Kgsm:Path"] ?? "";
        string kgsmSocketPath = builder.Configuration["Kgsm:SocketPath"] ?? "";

        builder.Services
            .AddSingleton<KgsmEventState>()
            .AddSingleton(new KgsmInterop(kgsmPath, kgsmSocketPath))
            .AddSingleton<KgsmEventListener>()
            .AddLogging(options => options.AddConsole())
            .AddRazorComponents()
            .AddInteractiveServerComponents();

        var app = builder.Build();

        app.Services
            .GetRequiredService<KgsmEventListener>()
            .Initialize();

        app.Services
            .GetRequiredService<KgsmEventState>()
            .Initialize();

        // Configure the HTTP request pipeline.
        if (app.Environment.IsDevelopment() == false)
        {
            app.UseExceptionHandler("/Error", createScopeForErrors: true);
            // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
            app.UseHsts();
        }

        app.UseHttpsRedirection();

        app.UseStaticFiles();
        app.UseAntiforgery();

        app.MapRazorComponents<App>()
            .AddInteractiveServerRenderMode();

        app.Run();
    }
}