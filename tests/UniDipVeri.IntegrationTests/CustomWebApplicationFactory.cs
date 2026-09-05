using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using UniDipVeri.Infrastructure.Persistence;

namespace UniDipVeri.IntegrationTests;

public class CustomWebApplicationFactory(string connectionString) : WebApplicationFactory<Program>
{
    private readonly string _connectionString = connectionString;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureAppConfiguration((context, config) =>
        {
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = _connectionString,
                ["JwtSettings:SecretKey"] = "UniDipVeriIntegrationTestSecretKeyForTestingPurposesOnly123!",
                ["JwtSettings:Issuer"] = "UniDipVeriTestIssuer",
                ["JwtSettings:Audience"] = "UniDipVeriTestAudience",
                ["JwtSettings:ExpirationInHours"] = "1"
            });
        });

        builder.ConfigureServices(services =>
        {
            var descriptors = services.Where(d =>
                d.ServiceType == typeof(DbContextOptions<UniDipVeriDbContext>) ||
                d.ServiceType == typeof(DbContextOptions)).ToList();

            foreach (var descriptor in descriptors)
            {
                services.Remove(descriptor);
            }

            services.AddDbContext<UniDipVeriDbContext>(options =>
            {
                options.UseNpgsql(_connectionString);
            });
        });
    }
}
