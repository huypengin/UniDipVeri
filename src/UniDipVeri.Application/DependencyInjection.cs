using Microsoft.Extensions.DependencyInjection;
using UniDipVeri.Application.Features.Auth.Abstractions;
using UniDipVeri.Application.Features.Auth.Services;
using UniDipVeri.Application.Features.Staff.Abstractions;
using UniDipVeri.Application.Features.Staff.Services;

namespace UniDipVeri.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        services.AddScoped<IAuthService, AuthService>();
        services.AddScoped<IStaffService, StaffService>();
        return services;
    }
}
