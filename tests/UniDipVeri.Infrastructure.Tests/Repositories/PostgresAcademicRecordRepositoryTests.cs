using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using UniDipVeri.Domain.Entities;
using UniDipVeri.Domain.Enums;
using UniDipVeri.Infrastructure.Persistence;
using UniDipVeri.Infrastructure.Persistence.Repositories;

namespace UniDipVeri.Infrastructure.Tests.Repositories;

public class PostgresAcademicRecordRepositoryTests : IDisposable
{
    private readonly UniDipVeriDbContext _dbContext;
    private readonly PostgresAcademicRecordRepository _repository;
    private readonly Guid _programId = Guid.NewGuid();
    private readonly Guid _universityId = Guid.NewGuid();
    private readonly Student _student;

    public PostgresAcademicRecordRepositoryTests()
    {
        var options = new DbContextOptionsBuilder<UniDipVeriDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;

        _dbContext = new UniDipVeriDbContext(options);
        _dbContext.Database.EnsureCreated();

        _dbContext.Universities.Add(University.Create(
            "Mekong International University",
            "MIU",
            "did:jwk:test",
            id: _universityId));

        _dbContext.Programs.Add(Program.Create(
            _universityId,
            "Computer Science",
            "Bachelor of Science in Computer Science",
            DegreeLevel.BACHELOR,
            id: _programId));

        _student = Student.Create(
            _programId,
            "MIU2026-001",
            "Nguyen Minh Anh",
            "anh.nguyen@student.miu.example",
            "SRC-001");

        _dbContext.Students.Add(_student);
        _dbContext.SaveChanges();

        _repository = new PostgresAcademicRecordRepository(_dbContext);
    }

    [Fact]
    public async Task AddAsync_And_GetByStudentIdAsync_ShouldWorkCorrectly()
    {
        // Arrange
        var courses = new List<string> { "CS101", "CS102", "CS201" };
        var snapshotTime = DateTime.UtcNow.AddDays(-2);
        var record = AcademicRecord.Create(
            _student.Id,
            120,
            3.85m,
            courses,
            snapshotTime);

        // Act
        await _repository.AddAsync(record);
        var retrieved = await _repository.GetByStudentIdAsync(_student.Id);

        // Assert
        retrieved.Should().NotBeNull();
        retrieved!.Id.Should().Be(record.Id);
        retrieved.StudentId.Should().Be(_student.Id);
        retrieved.CreditsCompleted.Should().Be(120);
        retrieved.Gpa.Should().Be(3.85m);
        retrieved.CompletedCourses.Should().Equal("CS101", "CS102", "CS201");
        retrieved.Student.Should().NotBeNull();
        retrieved.Student!.StudentNumber.Should().Be("MIU2026-001");
    }

    [Fact]
    public async Task GetByStudentIdAsync_ShouldReturnNull_WhenNotFoundOrEmpty()
    {
        var notFound = await _repository.GetByStudentIdAsync(Guid.NewGuid());
        notFound.Should().BeNull();

        var empty = await _repository.GetByStudentIdAsync(Guid.Empty);
        empty.Should().BeNull();
    }

    [Fact]
    public async Task UpdateAsync_ShouldPersistChanges()
    {
        // Arrange
        var record = AcademicRecord.Create(
            _student.Id,
            60,
            3.20m,
            ["CS101"],
            DateTime.UtcNow.AddMonths(-1));
        await _repository.AddAsync(record);

        // Act
        record.UpdateRecord(90, 3.65m, ["CS101", "CS102"], DateTime.UtcNow);
        await _repository.UpdateAsync(record);

        var updated = await _repository.GetByStudentIdAsync(_student.Id);

        // Assert
        updated.Should().NotBeNull();
        updated!.CreditsCompleted.Should().Be(90);
        updated.Gpa.Should().Be(3.65m);
        updated.CompletedCourses.Should().Equal("CS101", "CS102");
    }

    public void Dispose()
    {
        _dbContext.Database.EnsureDeleted();
        _dbContext.Dispose();
    }
}
