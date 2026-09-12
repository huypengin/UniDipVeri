using FluentAssertions;
using Moq;
using UniDipVeri.Application.Abstractions.Repositories;
using UniDipVeri.Application.Features.Programs.Models;
using UniDipVeri.Application.Features.Programs.Services;
using UniDipVeri.Domain.Entities;
using UniDipVeri.Domain.Enums;

namespace UniDipVeri.Application.Tests.Services;

public class ProgramServiceTests
{
    private readonly Mock<IProgramRepository> _programRepoMock = new();
    private readonly Guid _universityId = Guid.NewGuid();
    private readonly ProgramService _service;

    public ProgramServiceTests()
    {
        _programRepoMock.Setup(r => r.GetDefaultUniversityIdAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(_universityId);
        _service = new ProgramService(_programRepoMock.Object);
    }

    #region CreateProgramAsync Tests

    [Fact]
    public async Task CreateProgramAsync_ShouldReturnValidation_WhenRequestIsNull()
    {
        var result = await _service.CreateProgramAsync(null!);

        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(ProgramErrorType.Validation);
        result.Error.Should().Contain("required");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task CreateProgramAsync_ShouldReturnValidation_WhenNameIsBlank(string name)
    {
        var request = new CreateProgramRequest
        {
            Name = name,
            FullTitle = "Bachelor of Science in CS",
            DegreeLevel = "BACHELOR"
        };

        var result = await _service.CreateProgramAsync(request);

        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(ProgramErrorType.Validation);
        result.Error.Should().Contain("name");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task CreateProgramAsync_ShouldReturnValidation_WhenFullTitleIsBlank(string title)
    {
        var request = new CreateProgramRequest
        {
            Name = "Computer Science",
            FullTitle = title,
            DegreeLevel = "BACHELOR"
        };

        var result = await _service.CreateProgramAsync(request);

        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(ProgramErrorType.Validation);
        result.Error.Should().Contain("full title");
    }

    [Fact]
    public async Task CreateProgramAsync_ShouldReturnValidation_WhenDegreeLevelIsInvalid()
    {
        var request = new CreateProgramRequest
        {
            Name = "Computer Science",
            FullTitle = "Bachelor of Computer Science",
            DegreeLevel = "INVALID_LEVEL"
        };

        var result = await _service.CreateProgramAsync(request);

        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(ProgramErrorType.Validation);
        result.Error.Should().Contain("Invalid degree level");
    }

    [Theory]
    [InlineData("BACHELOR", "Master of Science in CS")]
    [InlineData("MASTER", "Bachelor of Science in SE")]
    [InlineData("DOCTORATE", "Master of Philosophy in AI")]
    [InlineData("ASSOCIATE", "Bachelor of Applied Studies")]
    public async Task CreateProgramAsync_ShouldReturnValidation_WhenKeywordMismatchesDegreeLevel_FR_PROG_05(string level, string title)
    {
        var request = new CreateProgramRequest
        {
            Name = "Mismatched Program",
            FullTitle = title,
            DegreeLevel = level
        };

        var result = await _service.CreateProgramAsync(request);

        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(ProgramErrorType.Validation);
        result.Error.Should().Contain("does not match");
    }

    [Fact]
    public async Task CreateProgramAsync_ShouldReturnConflict_WhenProgramNameAlreadyExists()
    {
        var request = new CreateProgramRequest
        {
            Name = "Computer Science",
            FullTitle = "Bachelor of Science in Computer Science",
            DegreeLevel = "BACHELOR"
        };

        _programRepoMock.Setup(r => r.ExistsByNameAsync(_universityId, "Computer Science", null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        var result = await _service.CreateProgramAsync(request);

        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(ProgramErrorType.Conflict);
        result.Error.Should().Contain("already exists");
    }

    [Theory]
    [InlineData("BACHELOR", "Bachelor of Science in Computer Science")]
    [InlineData("MASTER", "Master of Science in Software Engineering")]
    [InlineData("DOCTORATE", "Doctor of Philosophy in Artificial Intelligence")]
    [InlineData("DOCTORATE", "PhD in Cybernetics")]
    [InlineData("ASSOCIATE", "Associate Degree in Information Systems")]
    public async Task CreateProgramAsync_ShouldSucceed_WhenValidInputAndMatchingKeyword(string level, string title)
    {
        var request = new CreateProgramRequest
        {
            Name = "Valid Program",
            FullTitle = title,
            DegreeLevel = level
        };

        _programRepoMock.Setup(r => r.ExistsByNameAsync(_universityId, "Valid Program", null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);

        var result = await _service.CreateProgramAsync(request);

        result.IsSuccess.Should().BeTrue();
        result.Data.Should().NotBeNull();
        result.Data!.Name.Should().Be("Valid Program");
        result.Data.FullTitle.Should().Be(title);
        result.Data.DegreeLevel.Should().Be(level.ToUpperInvariant());
        result.Data.Status.Should().Be("ACTIVE");

        _programRepoMock.Verify(r => r.AddAsync(It.Is<Program>(p => p.Name == "Valid Program"), It.IsAny<CancellationToken>()), Times.Once);
    }

    #endregion

    #region ListProgramsAsync Tests

    [Fact]
    public async Task ListProgramsAsync_ShouldReturnAllPrograms()
    {
        var programs = new List<Program>
        {
            Program.Create(_universityId, "CS", "Bachelor of CS", DegreeLevel.BACHELOR),
            Program.Create(_universityId, "SE", "Master of SE", DegreeLevel.MASTER)
        };

        _programRepoMock.Setup(r => r.ListAllAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(programs);

        var result = await _service.ListProgramsAsync();

        result.IsSuccess.Should().BeTrue();
        result.Data.Should().HaveCount(2);
        result.Data![0].Name.Should().Be("CS");
        result.Data[1].Name.Should().Be("SE");
    }

    [Fact]
    public async Task ListProgramsAsync_ShouldReturnEmptyList_WhenNoProgramsExist()
    {
        _programRepoMock.Setup(r => r.ListAllAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<Program>());

        var result = await _service.ListProgramsAsync();

        result.IsSuccess.Should().BeTrue();
        result.Data.Should().BeEmpty();
    }

    #endregion

    #region GetProgramByIdAsync Tests

    [Fact]
    public async Task GetProgramByIdAsync_ShouldReturnNotFound_WhenIdIsEmpty()
    {
        var result = await _service.GetProgramByIdAsync(Guid.Empty);

        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(ProgramErrorType.NotFound);
    }

    [Fact]
    public async Task GetProgramByIdAsync_ShouldReturnNotFound_WhenProgramDoesNotExist()
    {
        var id = Guid.NewGuid();
        _programRepoMock.Setup(r => r.GetByIdAsync(id, It.IsAny<CancellationToken>()))
            .ReturnsAsync((Program?)null);

        var result = await _service.GetProgramByIdAsync(id);

        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(ProgramErrorType.NotFound);
    }

    [Fact]
    public async Task GetProgramByIdAsync_ShouldReturnProgram_WhenFound()
    {
        var id = Guid.NewGuid();
        var program = Program.Create(_universityId, "CS", "Bachelor of Science in CS", DegreeLevel.BACHELOR, id: id);

        _programRepoMock.Setup(r => r.GetByIdAsync(id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(program);

        var result = await _service.GetProgramByIdAsync(id);

        result.IsSuccess.Should().BeTrue();
        result.Data.Should().NotBeNull();
        result.Data!.Id.Should().Be(id);
        result.Data.Name.Should().Be("CS");
    }

    #endregion

    #region UpdateProgramAsync Tests

    [Fact]
    public async Task UpdateProgramAsync_ShouldReturnNotFound_WhenProgramDoesNotExist()
    {
        var id = Guid.NewGuid();
        _programRepoMock.Setup(r => r.GetByIdAsync(id, It.IsAny<CancellationToken>()))
            .ReturnsAsync((Program?)null);

        var result = await _service.UpdateProgramAsync(id, new UpdateProgramRequest { Name = "New Name" });

        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(ProgramErrorType.NotFound);
    }

    [Fact]
    public async Task UpdateProgramAsync_ShouldReturnValidation_WhenRequestIsNull()
    {
        var result = await _service.UpdateProgramAsync(Guid.NewGuid(), null!);

        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(ProgramErrorType.Validation);
    }

    [Fact]
    public async Task UpdateProgramAsync_ShouldReturnConflict_WhenNameAlreadyTakenByAnotherProgram()
    {
        var id = Guid.NewGuid();
        var program = Program.Create(_universityId, "CS", "Bachelor of Science in CS", DegreeLevel.BACHELOR, id: id);

        _programRepoMock.Setup(r => r.GetByIdAsync(id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(program);
        _programRepoMock.Setup(r => r.ExistsByNameAsync(_universityId, "Software Engineering", id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        var request = new UpdateProgramRequest { Name = "Software Engineering" };
        var result = await _service.UpdateProgramAsync(id, request);

        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(ProgramErrorType.Conflict);
    }

    [Fact]
    public async Task UpdateProgramAsync_ShouldReturnValidation_WhenDegreeLevelIsInvalid()
    {
        var id = Guid.NewGuid();
        var program = Program.Create(_universityId, "CS", "Bachelor of Science in CS", DegreeLevel.BACHELOR, id: id);

        _programRepoMock.Setup(r => r.GetByIdAsync(id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(program);

        var request = new UpdateProgramRequest { DegreeLevel = "NOT_A_LEVEL" };
        var result = await _service.UpdateProgramAsync(id, request);

        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(ProgramErrorType.Validation);
    }

    [Fact]
    public async Task UpdateProgramAsync_ShouldReturnValidation_WhenUpdatedTitleMismatchesDegreeLevel_FR_PROG_05()
    {
        var id = Guid.NewGuid();
        var program = Program.Create(_universityId, "CS", "Bachelor of Science in CS", DegreeLevel.BACHELOR, id: id);

        _programRepoMock.Setup(r => r.GetByIdAsync(id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(program);

        var request = new UpdateProgramRequest
        {
            FullTitle = "Master of Science in Computing" // Mismatches current BACHELOR
        };

        var result = await _service.UpdateProgramAsync(id, request);

        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(ProgramErrorType.Validation);
    }

    [Fact]
    public async Task UpdateProgramAsync_ShouldSucceed_WhenValidUpdatesProvided()
    {
        var id = Guid.NewGuid();
        var program = Program.Create(_universityId, "CS", "Bachelor of Science in CS", DegreeLevel.BACHELOR, id: id);

        _programRepoMock.Setup(r => r.GetByIdAsync(id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(program);
        _programRepoMock.Setup(r => r.ExistsByNameAsync(_universityId, "Computer Engineering", id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);

        var request = new UpdateProgramRequest
        {
            Name = "Computer Engineering",
            FullTitle = "Master of Science in Computer Engineering",
            DegreeLevel = "MASTER",
            Status = "INACTIVE"
        };

        var result = await _service.UpdateProgramAsync(id, request);

        result.IsSuccess.Should().BeTrue();
        result.Data.Should().NotBeNull();
        result.Data!.Name.Should().Be("Computer Engineering");
        result.Data.FullTitle.Should().Be("Master of Science in Computer Engineering");
        result.Data.DegreeLevel.Should().Be("MASTER");
        result.Data.Status.Should().Be("INACTIVE");

        _programRepoMock.Verify(r => r.UpdateAsync(It.Is<Program>(p => p.Id == id && p.Status == ProgramStatus.INACTIVE), It.IsAny<CancellationToken>()), Times.Once);
    }

    #endregion
}
