using Microsoft.EntityFrameworkCore;
using Testcontainers.PostgreSql;
using UniDipVeri.Infrastructure.Persistence;
using Xunit;

namespace UniDipVeri.IntegrationTests;

public class PostgreSqlTestFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithDatabase("unidipveri_test")
        .WithUsername("postgres")
        .WithPassword("postgres")
        .Build();

    public string ConnectionString => _container.GetConnectionString();
    public CustomWebApplicationFactory Factory { get; private set; } = null!;

    public async Task InitializeAsync()
    {
        try
        {
            await _container.StartAsync();
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException(
                "Failed to start PostgreSQL testcontainer. Ensure Docker or a container runtime is running (e.g. Docker Desktop, Podman). " +
                "Error: " + ex.Message, ex);
        }

        var options = new DbContextOptionsBuilder<UniDipVeriDbContext>()
            .UseNpgsql(ConnectionString)
            .Options;

        await using var context = new UniDipVeriDbContext(options);
        await context.Database.EnsureCreatedAsync();

        Factory = new CustomWebApplicationFactory(ConnectionString);
    }

    public async Task DisposeAsync()
    {
        if (Factory is not null)
        {
            await Factory.DisposeAsync();
        }
        await _container.DisposeAsync();
    }
}

[CollectionDefinition("PostgreSqlIntegrationCollection")]
public class PostgreSqlIntegrationCollection : ICollectionFixture<PostgreSqlTestFixture>
{
}
