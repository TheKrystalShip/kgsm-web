using TheKrystalShip.KGSM;
using TheKrystalShip.KGSM.Web.Components;
using TheKrystalShip.KGSM.Web.Services;

public class Program
{
    public static void Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);

        // Add services to the container.
        builder.Services
            .AddSingleton(new KgsmInterop("", ""))
            .AddSingleton<KgsmEventListener>()
            .AddLogging(options => options.AddConsole())
            .AddRazorComponents()
            .AddInteractiveServerComponents();

        var app = builder.Build();

        app.Services
            .GetRequiredService<KgsmEventListener>()
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
