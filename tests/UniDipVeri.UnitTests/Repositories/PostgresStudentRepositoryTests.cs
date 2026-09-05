using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using UniDipVeri.Application.Abstractions.Models;
using UniDipVeri.Domain.Entities;
using UniDipVeri.Domain.Enums;
using UniDipVeri.Infrastructure.Persistence;
using UniDipVeri.Infrastructure.Persistence.Repositories;

namespace UniDipVeri.UnitTests.Repositories;

public class PostgresStudentRepositoryTests : IDisposable
{
    private readonly UniDipVeriDbContext _dbContext;
    private readonly PostgresStudentRepository _repository;
    private readonly Guid _universityId = Guid.NewGuid();
    private readonly Guid _programId = Guid.NewGuid();

    public PostgresStudentRepositoryTests()
    {
        var options = new DbContextOptionsBuilder<UniDipVeriDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;

        _dbContext = new UniDipVeriDbContext(options);
        _dbContext.Database.EnsureCreated();

        // Seed University & Program
        _dbContext.Universities.Add(University.Create(
            "Mekong International University",
            "MIU",
            "did:jwk:123",
            id: _universityId));

        _dbContext.Programs.Add(UniDipVeri.Domain.Entities.Program.Create(
            _universityId,
            "Computer Science",
            "Bachelor of Science in Computer Science",
            DegreeLevel.BACHELOR,
            id: _programId));

        _dbContext.SaveChanges();

        _repository = new PostgresStudentRepository(_dbContext);
    }

    [Fact]
    public async Task AddAsync_And_GetByStudentNumberAsync_ShouldWorkCorrectly()
    {
        // Arrange
        var student = Student.Create(
            _programId,
            "MIU2026-001",
            "Nguyen Minh Anh",
            "anh.nguyen@student.miu.edu",
            "SRC-001",
            "hash123");

        // Act
        await _repository.AddAsync(student);
        var retrieved = await _repository.GetByStudentNumberAsync("MIU2026-001");

        // Assert
        retrieved.Should().NotBeNull();
        retrieved!.Name.Should().Be("Nguyen Minh Anh");
        retrieved.Email.Should().Be("anh.nguyen@student.miu.edu");
        retrieved.AccountStatus.Should().Be(StudentAccountStatus.PENDING_ACTIVATION);
        retrieved.GraduationStatus.Should().Be(GraduationStatus.NOT_STARTED);
        retrieved.Program.Should().NotBeNull();
        retrieved.Program!.Name.Should().Be("Computer Science");
    }

    [Fact]
    public async Task GetByEmailAsync_ShouldBeCaseInsensitive()
    {
        // Arrange
        var student = Student.Create(
            _programId,
            "MIU2026-002",
            "Tran Thi B",
            "Tran.B@student.miu.edu",
            "SRC-002",
            "hash123");
        student.ActivateAccount();
        student.UpdateGraduationStatus(GraduationStatus.ELIGIBLE);
        await _repository.AddAsync(student);

        // Act
        var retrieved = await _repository.GetByEmailAsync("tran.b@student.miu.edu");

        // Assert
        retrieved.Should().NotBeNull();
        retrieved!.Id.Should().Be(student.Id);
        retrieved.AccountStatus.Should().Be(StudentAccountStatus.ACTIVE);
        retrieved.GraduationStatus.Should().Be(GraduationStatus.ELIGIBLE);
    }

    [Fact]
    public async Task ListPagedAsync_ShouldFilterAndPaginateCorrectly()
    {
        // Arrange
        for (int i = 1; i <= 15; i++)
        {
            var student = Student.Create(
                _programId,
                $"MIU2026-{i:D3}",
                $"Student {i}",
                $"student{i}@miu.edu",
                $"SRC-{i:D3}",
                "hash");

            if (i <= 10)
            {
                student.ActivateAccount();
            }

            if (i <= 5)
            {
                student.UpdateGraduationStatus(GraduationStatus.ELIGIBLE);
            }
            else if (i <= 10)
            {
                student.UpdateGraduationStatus(GraduationStatus.REJECTED);
            }

            if (i == 1)
            {
                student.AssignWallet("wallet-001");
            }

            await _repository.AddAsync(student);
        }

        // Act & Assert: Filter by Program
        var result1 = await _repository.ListPagedAsync(new StudentFilter { ProgramId = _programId });
        result1.TotalCount.Should().Be(15);
        result1.Items.Count.Should().Be(15);

        // Filter by AccountStatus
        var result2 = await _repository.ListPagedAsync(new StudentFilter { AccountStatus = StudentAccountStatus.ACTIVE });
        result2.TotalCount.Should().Be(10);

        // Filter by GraduationStatus
        var result3 = await _repository.ListPagedAsync(new StudentFilter { GraduationStatus = GraduationStatus.ELIGIBLE });
        result3.TotalCount.Should().Be(5);

        // Filter by WalletStatus
        var result4 = await _repository.ListPagedAsync(new StudentFilter { WalletStatus = WalletStatus.ACTIVE });
        result4.TotalCount.Should().Be(1);

        // Search Term
        var result5 = await _repository.ListPagedAsync(new StudentFilter { SearchTerm = "Student 1" });
        result5.TotalCount.Should().Be(7); // 1, 10, 11, 12, 13, 14, 15

        // Pagination
        var result6 = await _repository.ListPagedAsync(new StudentFilter { Page = 2, PageSize = 5 });
        result6.Items.Count.Should().Be(5);
        result6.Page.Should().Be(2);
        result6.TotalPages.Should().Be(3);
    }

    [Fact]
    public async Task UpdateAsync_ShouldPersistChanges()
    {
        // Arrange
        var student = Student.Create(
            _programId,
            "MIU2026-999",
            "Update Test",
            "update@test.com",
            "SRC-999",
            "hash");
        await _repository.AddAsync(student);

        // Act
        student.ActivateAccount();
        student.UpdateGraduationStatus(GraduationStatus.ELIGIBLE);
        student.AssignWallet("walt-wallet-xyz");
        await _repository.UpdateAsync(student);

        var updated = await _repository.GetByIdAsync(student.Id);

        // Assert
        updated.Should().NotBeNull();
        updated!.AccountStatus.Should().Be(StudentAccountStatus.ACTIVE);
        updated.GraduationStatus.Should().Be(GraduationStatus.ELIGIBLE);
        updated.WalletId.Should().Be("walt-wallet-xyz");
        updated.WalletStatus.Should().Be(WalletStatus.ACTIVE);
        updated.IsWalletReady().Should().BeTrue();
        updated.IsAccountActive().Should().BeTrue();
    }

    public void Dispose()
    {
        _dbContext.Database.EnsureDeleted();
        _dbContext.Dispose();
    }
}
