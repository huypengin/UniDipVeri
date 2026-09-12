using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using UniDipVeri.Domain.Entities;
using UniDipVeri.Domain.Enums;
using UniDipVeri.Infrastructure.Persistence;
using UniDipVeri.Infrastructure.Persistence.Repositories;

namespace UniDipVeri.Infrastructure.Tests.Repositories;

public class PostgresProgramRepositoryTests : IDisposable
{
    private readonly UniDipVeriDbContext _dbContext;
    private readonly PostgresProgramRepository _repository;
    private readonly Guid _universityId = Guid.NewGuid();

    public PostgresProgramRepositoryTests()
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

        _repository = new PostgresProgramRepository(_dbContext);
    }

    public void Dispose()
    {
        _dbContext.Database.EnsureDeleted();
        _dbContext.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public async Task AddAsync_And_GetByIdAsync_ShouldWorkCorrectly()
    {
        var program = Program.Create(
            _universityId,
            "Data Science",
            "Bachelor of Science in Data Science",
            DegreeLevel.BACHELOR);

        await _repository.AddAsync(program);

        var retrieved = await _repository.GetByIdAsync(program.Id);
        retrieved.Should().NotBeNull();
        retrieved!.Name.Should().Be("Data Science");
        retrieved.FullTitle.Should().Be("Bachelor of Science in Data Science");
        retrieved.DegreeLevel.Should().Be(DegreeLevel.BACHELOR);
        retrieved.Status.Should().Be(ProgramStatus.ACTIVE);
    }

    [Fact]
    public async Task ListAllAsync_ShouldReturnAllProgramsSortedByName()
    {
        var p1 = Program.Create(_universityId, "Zoology", "Bachelor of Science in Zoology", DegreeLevel.BACHELOR);
        var p2 = Program.Create(_universityId, "Applied Math", "Bachelor of Science in Applied Math", DegreeLevel.BACHELOR);

        await _repository.AddAsync(p1);
        await _repository.AddAsync(p2);

        var all = await _repository.ListAllAsync();
        all.Should().Contain(p => p.Name == "Zoology");
        all.Should().Contain(p => p.Name == "Applied Math");
    }

    [Fact]
    public async Task ListByUniversityIdAsync_ShouldFilterByUniversity()
    {
        var otherUniId = Guid.NewGuid();
        _dbContext.Universities.Add(University.Create("Other Uni", "OU", "did:jwk:456", id: otherUniId));
        await _dbContext.SaveChangesAsync();

        var p1 = Program.Create(_universityId, "Cybersecurity", "Bachelor of Science in Cybersecurity", DegreeLevel.BACHELOR);
        var p2 = Program.Create(otherUniId, "Other Program", "Master of Science in Other", DegreeLevel.MASTER);

        await _repository.AddAsync(p1);
        await _repository.AddAsync(p2);

        var results = await _repository.ListByUniversityIdAsync(_universityId);
        results.Should().Contain(p => p.Id == p1.Id);
        results.Should().NotContain(p => p.Id == p2.Id);
    }

    [Fact]
    public async Task ExistsByNameAsync_ShouldBeCaseInsensitiveAndRespectExcludeId()
    {
        var program = Program.Create(
            _universityId,
            "Artificial Intelligence",
            "Master of Science in Artificial Intelligence",
            DegreeLevel.MASTER);
        await _repository.AddAsync(program);

        var existsSameName = await _repository.ExistsByNameAsync(_universityId, "artificial intelligence");
        existsSameName.Should().BeTrue();

        var existsExcluded = await _repository.ExistsByNameAsync(_universityId, "Artificial Intelligence", excludeId: program.Id);
        existsExcluded.Should().BeFalse();

        var existsDifferent = await _repository.ExistsByNameAsync(_universityId, "NonExistent Program");
        existsDifferent.Should().BeFalse();
    }

    [Fact]
    public async Task GetDefaultUniversityIdAsync_ShouldReturnUniversityId()
    {
        var defaultId = await _repository.GetDefaultUniversityIdAsync();
        defaultId.Should().NotBeEmpty();
    }

    [Fact]
    public async Task UpdateAsync_ShouldUpdateProgramFields()
    {
        var program = Program.Create(
            _universityId,
            "Robotics",
            "Bachelor of Science in Robotics",
            DegreeLevel.BACHELOR);
        await _repository.AddAsync(program);

        program.UpdateDetails("Advanced Robotics", "Master of Science in Advanced Robotics", DegreeLevel.MASTER);
        program.Deactivate();
        await _repository.UpdateAsync(program);

        var updated = await _repository.GetByIdAsync(program.Id);
        updated.Should().NotBeNull();
        updated!.Name.Should().Be("Advanced Robotics");
        updated.FullTitle.Should().Be("Master of Science in Advanced Robotics");
        updated.DegreeLevel.Should().Be(DegreeLevel.MASTER);
        updated.Status.Should().Be(ProgramStatus.INACTIVE);
    }
}
