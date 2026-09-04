using Microsoft.Extensions.DependencyInjection;
using UniDipVeri.Application.Abstractions.Services;
using UniDipVeri.Application.Features.Auth.Services;

namespace UniDipVeri.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        services.AddScoped<IAuthService, AuthService>();
        return services;
    }
}
