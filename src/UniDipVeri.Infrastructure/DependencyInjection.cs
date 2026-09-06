using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using UniDipVeri.Application.Abstractions.Repositories;
using UniDipVeri.Application.Abstractions.Security;
using UniDipVeri.Infrastructure.Persistence;
using UniDipVeri.Infrastructure.Persistence.Repositories;
using UniDipVeri.Infrastructure.Security;

namespace UniDipVeri.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("DefaultConnection");
        services.AddDbContext<UniDipVeriDbContext>(options =>
        {
            if (!string.IsNullOrEmpty(connectionString))
            {
                options.UseNpgsql(connectionString);
            }
        });

        // Security
        services.AddScoped<IPasswordHasher, Pbkdf2PasswordHasher>();

        // Repositories
        services.AddScoped<IStaffRepository, PostgresStaffRepository>();
        services.AddScoped<IStudentRepository, PostgresStudentRepository>();

        return services;
    }
}
