using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using UniDipVeri.Domain.Entities;
using UniDipVeri.Domain.Enums;
using UniDipVeri.Infrastructure.Persistence;
using UniDipVeri.Infrastructure.Persistence.Repositories;

namespace UniDipVeri.Infrastructure.Tests.Repositories;

public class PostgresStaffRepositoryTests : IDisposable
{
    private readonly UniDipVeriDbContext _dbContext;
    private readonly PostgresStaffRepository _repository;
    private readonly Guid _universityId = Guid.NewGuid();

    public PostgresStaffRepositoryTests()
    {
        var options = new DbContextOptionsBuilder<UniDipVeriDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;

        _dbContext = new UniDipVeriDbContext(options);
        _dbContext.Database.EnsureCreated();

        // Seed University
        _dbContext.Universities.Add(University.Create(
            "Mekong International University",
            "MIU",
            "did:jwk:123",
            id: _universityId));
        _dbContext.SaveChanges();

        _repository = new PostgresStaffRepository(_dbContext);
    }

    [Fact]
    public async Task AddAsync_And_GetByIdAsync_ShouldWorkCorrectly()
    {
        // Arrange
        var staff = UniversityStaff.Create(
            _universityId,
            "John Registrar",
            "john@miu.edu",
            "hash123",
            StaffRole.REGISTRAR);

        // Act
        await _repository.AddAsync(staff);
        var retrieved = await _repository.GetByIdAsync(staff.Id);

        // Assert
        retrieved.Should().NotBeNull();
        retrieved!.Name.Should().Be("John Registrar");
        retrieved.Email.Should().Be("john@miu.edu");
        retrieved.Role.Should().Be(StaffRole.REGISTRAR);
    }

    [Fact]
    public async Task GetByEmailAsync_ShouldBeCaseInsensitive()
    {
        // Arrange
        var staff = UniversityStaff.Create(
            _universityId,
            "Admin User",
            "Admin.User@MIU.edu",
            "hash123",
            StaffRole.ADMIN);
        await _repository.AddAsync(staff);

        // Act
        var retrieved = await _repository.GetByEmailAsync("admin.user@miu.edu");

        // Assert
        retrieved.Should().NotBeNull();
        retrieved!.Id.Should().Be(staff.Id);
    }

    [Fact]
    public async Task CountActiveAdminsAsync_ShouldReturnCorrectCount()
    {
        // Arrange
        var admin1 = UniversityStaff.Create(
            _universityId,
            "Admin 1",
            "admin1@miu.edu",
            "hash1",
            StaffRole.ADMIN);

        var admin2 = UniversityStaff.Create(
            _universityId,
            "Admin 2 (Inactive)",
            "admin2@miu.edu",
            "hash2",
            StaffRole.ADMIN);
        admin2.Deactivate();

        var registrar = UniversityStaff.Create(
            _universityId,
            "Registrar",
            "registrar@miu.edu",
            "hash3",
            StaffRole.REGISTRAR);

        await _repository.AddAsync(admin1);
        await _repository.AddAsync(admin2);
        await _repository.AddAsync(registrar);

        // Act
        var activeAdmins = await _repository.CountActiveAdminsAsync();

        // Assert
        activeAdmins.Should().Be(1);
    }

    [Fact]
    public async Task UpdateAsync_ShouldPersistChanges()
    {
        // Arrange
        var staff = UniversityStaff.Create(
            _universityId,
            "Jane Staff",
            "jane@miu.edu",
            "hash123",
            StaffRole.REGISTRAR);
        await _repository.AddAsync(staff);

        // Act
        staff.UpdateRole(StaffRole.APPROVER);
        staff.Deactivate();
        await _repository.UpdateAsync(staff);

        var updated = await _repository.GetByIdAsync(staff.Id);

        // Assert
        updated.Should().NotBeNull();
        updated!.Role.Should().Be(StaffRole.APPROVER);
        updated.Status.Should().Be(StaffStatus.INACTIVE);
        updated.IsActive().Should().BeFalse();
    }

    public void Dispose()
    {
        _dbContext.Database.EnsureDeleted();
        _dbContext.Dispose();
    }
}
